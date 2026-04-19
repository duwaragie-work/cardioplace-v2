"""
Tool definitions and handlers for the Groq/Cerebras-driven voice agent.

Each tool is a (schema, handler) pair. Schemas are the OpenAI-compatible JSON
format that Groq and Cerebras both accept. Handlers make the same HTTP calls to
NestJS that the legacy ADK tools.py does and emit the same ServerMessage protos
(ActionNotice, CheckinSaved, CheckinUpdated, CheckinDeleted, ActionComplete)
so the frontend's card-rendering flow doesn't change.
"""

from __future__ import annotations

import logging
import os
import time
from datetime import datetime, timedelta
from typing import Any, Callable

import requests

logger = logging.getLogger(__name__)

NESTJS_URL = os.getenv("NESTJS_INTERNAL_URL", "http://localhost:8080/api")
REQUEST_TIMEOUT = 8  # seconds


# ── Tool JSON schemas ─────────────────────────────────────────────────────────
# Plain dicts — no Pydantic / Optional / Union types, because Llama 3.3 (and
# 2.5 native-audio earlier) rejects anyOf/null schemas. Sentinel defaults in
# handler logic stand in for "unchanged".
TOOL_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": "submit_checkin",
            "description": (
                "Save a new blood pressure reading after confirming values with the patient. "
                "Call ONCE after the patient says yes to saving."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "systolic_bp": {
                        "type": "integer",
                        "description": "Top BP number (60-250).",
                    },
                    "diastolic_bp": {
                        "type": "integer",
                        "description": "Bottom BP number (40-150).",
                    },
                    "medication_taken": {
                        "type": "boolean",
                        "description": "True if patient took all medications that day.",
                    },
                    "weight": {
                        "type": "number",
                        "description": "Weight in lbs. 0 if not provided.",
                    },
                    "symptoms": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Symptoms reported. ALWAYS English (e.g. 'headache').",
                    },
                    "notes": {
                        "type": "string",
                        "description": "Extra notes in English. Empty string if none.",
                    },
                    "entry_date": {
                        "type": "string",
                        "description": "YYYY-MM-DD. Empty string means today.",
                    },
                    "measurement_time": {
                        "type": "string",
                        "description": "HH:mm 24-hour format, or 'now' for current time.",
                    },
                },
                "required": ["systolic_bp", "diastolic_bp", "medication_taken"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_recent_readings",
            "description": (
                "List the patient's past BP readings. Returns entry_ids the model can use "
                "for update_checkin and delete_checkin."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "days": {
                        "type": "integer",
                        "description": "Days to look back (1-30). Defaults to 7.",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_checkin",
            "description": (
                "Modify an existing reading. Pass sentinel values for fields you don't want "
                "to change: 0 for numeric, empty string for strings, 'yes'/'no'/'' for "
                "medication_taken, empty list for symptoms."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "entry_id": {"type": "string"},
                    "systolic_bp": {"type": "integer", "description": "0 = unchanged"},
                    "diastolic_bp": {"type": "integer", "description": "0 = unchanged"},
                    "medication_taken": {
                        "type": "string",
                        "description": "'yes' | 'no' | '' (unchanged)",
                    },
                    "weight": {"type": "number", "description": "0 = unchanged"},
                    "symptoms": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Empty list = unchanged.",
                    },
                    "notes": {"type": "string", "description": "Empty = unchanged."},
                    "measurement_time": {"type": "string", "description": "Empty = unchanged."},
                },
                "required": ["entry_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "delete_checkin",
            "description": (
                "Delete one or more readings by entry_id. Pass a comma-separated string for "
                "multiple ('id1,id2,id3') or a single id."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "entry_ids": {
                        "type": "string",
                        "description": "Comma-separated entry IDs.",
                    },
                },
                "required": ["entry_ids"],
            },
        },
    },
]


# ── Handler factory ───────────────────────────────────────────────────────────
# Each handler is a closure over auth_token + emit() so it can fire proto
# messages onto the VoiceSession's out_queue while running.

EmitFn = Callable[[Any], None]  # emits a voice_pb2.ServerMessage


def make_handlers(auth_token: str, emit: EmitFn, patient_timezone: str = "America/New_York") -> dict[str, Callable[[dict], dict]]:
    """
    Return a dict mapping function names to handler callables. Each handler
    takes the args dict parsed from the LLM tool call and returns a result dict
    that gets appended to the conversation history as a `tool` role message.
    """
    # Late import so piper/grpc bootstrap isn't coupled to proto generation.
    from generated import voice_pb2

    headers = {"Authorization": f"Bearer {auth_token}"}

    # ── submit_checkin ────────────────────────────────────────────────────
    def submit_checkin(args: dict) -> dict:
        systolic_bp = int(args.get("systolic_bp", 0))
        diastolic_bp = int(args.get("diastolic_bp", 0))
        medication_taken = bool(args.get("medication_taken", False))
        weight = float(args.get("weight", 0.0) or 0.0)
        symptoms = list(args.get("symptoms", []) or [])
        notes = str(args.get("notes", "") or "")
        entry_date = str(args.get("entry_date", "") or "")
        measurement_time = str(args.get("measurement_time", "") or "")

        if not (60 <= systolic_bp <= 250) or not (40 <= diastolic_bp <= 150):
            logger.warning("BP out of range: %d/%d — rejecting", systolic_bp, diastolic_bp)
            return {
                "saved": False,
                "message": (
                    f"BP values out of range ({systolic_bp}/{diastolic_bp}). Systolic 60-250, "
                    f"diastolic 40-150. Ask the patient to repeat."
                ),
            }

        emit(
            voice_pb2.ServerMessage(
                action=voice_pb2.ActionNotice(
                    type="submitting_checkin",
                    detail=(
                        f"BP={systolic_bp}/{diastolic_bp} "
                        f"meds={'taken' if medication_taken else 'missed'} "
                        f"symptoms={','.join(symptoms) if symptoms else 'none'} "
                        f"weight={weight or 'N/A'}"
                    ),
                )
            )
        )

        # Resolve date/time in patient timezone.
        try:
            from zoneinfo import ZoneInfo
            patient_now = datetime.now(ZoneInfo(patient_timezone))
        except Exception:
            patient_now = datetime.now()

        resolved_date = patient_now.strftime("%Y-%m-%d")
        if entry_date.strip():
            try:
                datetime.strptime(entry_date.strip(), "%Y-%m-%d")
                resolved_date = entry_date.strip()
            except ValueError:
                logger.warning("Invalid entry_date '%s', defaulting to today", entry_date)

        resolved_time = patient_now.strftime("%H:%M")
        mt = measurement_time.strip().lower()
        if mt and mt not in ("now", "current", "current time", "right now"):
            resolved_time = measurement_time.strip()

        payload: dict[str, Any] = {
            "entryDate": resolved_date,
            "systolicBP": systolic_bp,
            "diastolicBP": diastolic_bp,
            "medicationTaken": medication_taken,
            "symptoms": symptoms,
            "notes": notes,
            "measurementTime": resolved_time,
        }
        if weight > 0:
            payload["weight"] = weight

        saved = False
        try:
            t0 = time.time()
            resp = requests.post(
                f"{NESTJS_URL}/daily-journal",
                headers=headers,
                json=payload,
                timeout=REQUEST_TIMEOUT,
            )
            logger.info("[TOOL] submit_checkin POST %.0fms status=%s", (time.time() - t0) * 1000, resp.status_code)
            saved = resp.status_code in (200, 201, 202)
            if not saved:
                logger.warning("POST /daily-journal → %s: %s", resp.status_code, resp.text[:200])
        except requests.RequestException as exc:
            logger.error("POST /daily-journal failed: %s", exc)

        emit(
            voice_pb2.ServerMessage(
                checkin=voice_pb2.CheckinSaved(
                    systolic_bp=systolic_bp,
                    diastolic_bp=diastolic_bp,
                    weight=float(weight) if weight else 0.0,
                    medication_taken=medication_taken,
                    symptoms=symptoms,
                    saved=saved,
                )
            )
        )
        emit(
            voice_pb2.ServerMessage(
                action_complete=voice_pb2.ActionComplete(
                    type="submitting_checkin",
                    success=saved,
                    detail=f"BP={systolic_bp}/{diastolic_bp} saved={saved}",
                )
            )
        )
        return {
            "saved": saved,
            "entry_date_used": resolved_date,
            "measurement_time_used": resolved_time,
            "message": (
                f"Check-in saved for {resolved_date} at {resolved_time}."
                if saved
                else "Save failed — the care team may be offline. Ask patient to try again later."
            ),
        }

    # ── get_recent_readings ───────────────────────────────────────────────
    def get_recent_readings(args: dict) -> dict:
        days = int(args.get("days", 7) or 7)
        days = max(1, min(30, days))

        emit(
            voice_pb2.ServerMessage(
                action=voice_pb2.ActionNotice(
                    type="fetching_readings",
                    detail=f"Fetching last {days} days",
                )
            )
        )
        try:
            from zoneinfo import ZoneInfo
            try:
                tz = ZoneInfo(patient_timezone)
            except Exception:
                tz = ZoneInfo("America/New_York")
            now = datetime.now(tz)
            start_date = (now - timedelta(days=days)).strftime("%Y-%m-%d")
            end_date = now.strftime("%Y-%m-%d")

            t0 = time.time()
            resp = requests.get(
                f"{NESTJS_URL}/daily-journal",
                headers=headers,
                params={"startDate": start_date, "endDate": end_date, "limit": "5"},
                timeout=REQUEST_TIMEOUT,
            )
            logger.info("[TOOL] get_recent_readings GET %.0fms status=%s", (time.time() - t0) * 1000, resp.status_code)
            if resp.status_code == 200:
                data = resp.json()
                entries = data if isinstance(data, list) else data.get("data", [])
                lines: list[str] = []
                for e in entries[:5]:
                    eid = e.get("id", "unknown")
                    d = e.get("entryDate", "unknown")
                    t = e.get("measurementTime", "")
                    s = e.get("systolicBP", "?")
                    di = e.get("diastolicBP", "?")
                    med = "yes" if e.get("medicationTaken") else "no"
                    sym = ", ".join(e.get("symptoms", [])) if e.get("symptoms") else "none"
                    time_str = f" at {t}" if t else ""
                    lines.append(
                        f'entry_id="{eid}" | {d}{time_str} | BP {s}/{di} | meds {med} | symptoms: {sym}'
                    )
                summary = "\n".join(lines) if lines else "No readings found."
                emit(
                    voice_pb2.ServerMessage(
                        action_complete=voice_pb2.ActionComplete(
                            type="fetching_readings",
                            success=True,
                            detail=f"Found {len(lines)} readings",
                        )
                    )
                )
                return {"summary": summary, "count": len(lines)}
            emit(
                voice_pb2.ServerMessage(
                    action_complete=voice_pb2.ActionComplete(
                        type="fetching_readings",
                        success=False,
                        detail=f"HTTP {resp.status_code}",
                    )
                )
            )
            return {"readings": [], "count": 0}
        except requests.RequestException as exc:
            logger.error("GET /daily-journal failed: %s", exc)
            emit(
                voice_pb2.ServerMessage(
                    action_complete=voice_pb2.ActionComplete(
                        type="fetching_readings",
                        success=False,
                        detail="Connection failed",
                    )
                )
            )
            return {"summary": f"Could not fetch readings ({exc})", "count": 0}

    # ── update_checkin ────────────────────────────────────────────────────
    def update_checkin(args: dict) -> dict:
        entry_id = str(args.get("entry_id", "") or "")
        systolic_bp = int(args.get("systolic_bp", 0) or 0)
        diastolic_bp = int(args.get("diastolic_bp", 0) or 0)
        medication_taken_str = str(args.get("medication_taken", "") or "").strip().lower()
        weight = float(args.get("weight", 0.0) or 0.0)
        symptoms = list(args.get("symptoms", []) or [])
        notes = str(args.get("notes", "") or "")
        measurement_time = str(args.get("measurement_time", "") or "")

        if not entry_id:
            return {"updated": False, "message": "Missing entry_id."}

        payload: dict[str, Any] = {}
        if measurement_time:
            payload["measurementTime"] = measurement_time
        if systolic_bp > 0:
            payload["systolicBP"] = systolic_bp
        if diastolic_bp > 0:
            payload["diastolicBP"] = diastolic_bp
        if medication_taken_str in ("yes", "true", "taken"):
            payload["medicationTaken"] = True
        elif medication_taken_str in ("no", "false", "missed", "not taken"):
            payload["medicationTaken"] = False
        if weight > 0:
            payload["weight"] = weight
        if symptoms:
            payload["symptoms"] = symptoms
        if notes:
            payload["notes"] = notes

        if not payload:
            return {"updated": False, "message": "No fields to update."}

        changes: list[str] = []
        if "systolicBP" in payload:
            changes.append(f"systolic={payload['systolicBP']}")
        if "diastolicBP" in payload:
            changes.append(f"diastolic={payload['diastolicBP']}")
        if "medicationTaken" in payload:
            changes.append(f"medication={'taken' if payload['medicationTaken'] else 'missed'}")
        if "weight" in payload:
            changes.append(f"weight={payload['weight']}lbs")
        if "symptoms" in payload:
            syms = payload["symptoms"]
            changes.append(f"symptoms={','.join(syms) if syms else 'none'}")
        detail_str = f"entry={entry_id} changes=[{', '.join(changes)}]"

        emit(
            voice_pb2.ServerMessage(
                action=voice_pb2.ActionNotice(
                    type="updating_checkin",
                    detail=detail_str,
                )
            )
        )

        updated = False
        try:
            t0 = time.time()
            resp = requests.put(
                f"{NESTJS_URL}/daily-journal/{entry_id}",
                headers=headers,
                json=payload,
                timeout=REQUEST_TIMEOUT,
            )
            logger.info("[TOOL] update_checkin PUT %.0fms status=%s", (time.time() - t0) * 1000, resp.status_code)
            updated = resp.status_code in (200, 201, 202)
            if not updated:
                logger.warning("PUT /daily-journal/%s → %s: %s", entry_id, resp.status_code, resp.text[:200])
        except requests.RequestException as exc:
            logger.error("PUT /daily-journal/%s failed: %s", entry_id, exc)

        # Fetch updated entry so the card has final values.
        entry_date = ""
        final_systolic = payload.get("systolicBP", 0) or 0
        final_diastolic = payload.get("diastolicBP", 0) or 0
        final_weight = payload.get("weight", 0.0) or 0.0
        final_med = payload.get("medicationTaken", False)
        final_symptoms = payload.get("symptoms", []) or []
        if updated:
            try:
                gr = requests.get(
                    f"{NESTJS_URL}/daily-journal/{entry_id}",
                    headers=headers,
                    timeout=REQUEST_TIMEOUT,
                )
                if gr.status_code == 200:
                    d = gr.json()
                    entry_date = d.get("entryDate", "")
                    final_systolic = d.get("systolicBP", final_systolic) or 0
                    final_diastolic = d.get("diastolicBP", final_diastolic) or 0
                    final_weight = d.get("weight", final_weight) or 0.0
                    final_med = d.get("medicationTaken", final_med)
                    final_symptoms = d.get("symptoms", final_symptoms) or []
            except Exception:
                pass

        emit(
            voice_pb2.ServerMessage(
                updated=voice_pb2.CheckinUpdated(
                    entry_id=entry_id,
                    systolic_bp=int(final_systolic) if final_systolic else 0,
                    diastolic_bp=int(final_diastolic) if final_diastolic else 0,
                    weight=float(final_weight) if final_weight else 0.0,
                    medication_taken=bool(final_med),
                    symptoms=final_symptoms,
                    updated=updated,
                    entry_date=entry_date,
                )
            )
        )
        emit(
            voice_pb2.ServerMessage(
                action_complete=voice_pb2.ActionComplete(
                    type="updating_checkin",
                    success=updated,
                    detail=f"entry={entry_id} updated={updated}",
                )
            )
        )
        return {
            "updated": updated,
            "message": "Reading updated." if updated else "Could not update the reading.",
        }

    # ── delete_checkin ────────────────────────────────────────────────────
    def delete_checkin(args: dict) -> dict:
        raw = args.get("entry_ids", "")
        if isinstance(raw, list):
            ids = [str(x).strip() for x in raw if str(x).strip()]
        else:
            ids = [x.strip() for x in str(raw).split(",") if x.strip()]

        if not ids:
            emit(
                voice_pb2.ServerMessage(
                    action_complete=voice_pb2.ActionComplete(
                        type="deleting_checkin",
                        success=False,
                        detail="No entry IDs provided",
                    )
                )
            )
            return {"deleted_count": 0, "failed_count": 0, "message": "No entry IDs provided."}

        emit(
            voice_pb2.ServerMessage(
                action=voice_pb2.ActionNotice(
                    type="deleting_checkin",
                    detail=f"Deleting {len(ids)} entry(ies): {', '.join(ids[:5])}",
                )
            )
        )

        deleted_count = 0
        failed_count = 0
        t0 = time.time()
        for eid in ids:
            try:
                resp = requests.delete(
                    f"{NESTJS_URL}/daily-journal/{eid}",
                    headers=headers,
                    timeout=REQUEST_TIMEOUT,
                )
                if resp.status_code in (200, 204):
                    deleted_count += 1
                else:
                    failed_count += 1
                    logger.warning("DELETE /daily-journal/%s → %s", eid, resp.status_code)
            except requests.RequestException as exc:
                failed_count += 1
                logger.error("DELETE /daily-journal/%s failed: %s", eid, exc)
        logger.info(
            "[TOOL] delete_checkin %.0fms deleted=%d failed=%d",
            (time.time() - t0) * 1000,
            deleted_count,
            failed_count,
        )

        if failed_count == 0:
            msg = (
                "Reading deleted."
                if deleted_count == 1
                else f"{deleted_count} readings deleted."
            )
        elif deleted_count == 0:
            msg = "Could not delete the reading(s)."
        else:
            msg = f"Deleted {deleted_count}, but {failed_count} could not be deleted."

        emit(
            voice_pb2.ServerMessage(
                deleted=voice_pb2.CheckinDeleted(
                    entry_ids=ids,
                    deleted_count=deleted_count,
                    failed_count=failed_count,
                    success=(failed_count == 0),
                    message=msg,
                )
            )
        )
        emit(
            voice_pb2.ServerMessage(
                action_complete=voice_pb2.ActionComplete(
                    type="deleting_checkin",
                    success=(failed_count == 0),
                    detail=msg,
                )
            )
        )
        return {"deleted_count": deleted_count, "failed_count": failed_count, "message": msg}

    return {
        "submit_checkin": submit_checkin,
        "get_recent_readings": get_recent_readings,
        "update_checkin": update_checkin,
        "delete_checkin": delete_checkin,
    }
