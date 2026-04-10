"""
Tool functions for the Cardioplace ADK agent.

These functions are called by the Gemini model via ADK's function-calling mechanism.
Each tool closure captures the auth_token and loop/queue needed to notify the gRPC
stream when a tool completes.
"""

import asyncio
import logging
import os
import time as _time
from datetime import datetime, timedelta
from typing import Any

import requests

logger = logging.getLogger(__name__)

NESTJS_URL = os.getenv("NESTJS_INTERNAL_URL", "http://localhost:8080/api")
REQUEST_TIMEOUT = 8  # seconds — keep short to avoid long silences on failure


def make_tools(
    auth_token: str,
    out_queue: asyncio.Queue,
    loop: asyncio.AbstractEventLoop,
    patient_timezone: str = "America/New_York",
) -> list:
    """
    Return the list of ADK tool functions for a single voice session.

    Each tool is a closure that captures:
    - auth_token: JWT used to call the NestJS REST API
    - out_queue:  asyncio.Queue for pushing ServerMessages back to the gRPC stream
    - loop:       The running event loop (needed for thread-safe queue puts)
    """

    headers = {"Authorization": f"Bearer {auth_token}"}

    def _put(msg: Any) -> None:
        """Thread-safe put into the async out_queue."""
        asyncio.run_coroutine_threadsafe(out_queue.put(msg), loop)

    # ── Tool 1: Submit a new check-in ─────────────────────────────────────────

    def submit_checkin(
        systolic_bp: int,
        diastolic_bp: int,
        medication_taken: bool,
        weight: float = 0.0,
        symptoms: list[str] | None = None,
        notes: str = "",
        entry_date: str = "",
        measurement_time: str = "",
    ) -> dict:
        """
        Submit the patient's health check-in after all values have been
        confirmed with the patient. Call this only once the patient has said yes
        to saving.

        Args:
            systolic_bp:      Systolic blood pressure — the top number (60–250).
            diastolic_bp:     Diastolic blood pressure — the bottom number (40–150).
            medication_taken: Whether the patient took all their medications today.
            weight:           Weight in lbs (0 means not provided).
            symptoms:         List of symptoms the patient reported. ALWAYS in English
                              regardless of conversation language (e.g. "headache" not "dolor de cabeza").
            notes:            Any extra notes. ALWAYS in English regardless of conversation language.
            entry_date:       Date of the reading in YYYY-MM-DD format. Defaults
                              to today if not provided or blank.
            measurement_time: Time the reading was taken in HH:mm 24-hour format
                              (e.g. "08:30", "14:15"). Defaults to current time if
                              not provided or blank.

        Returns:
            dict with 'saved' (bool) and 'message' (str).
        """
        from generated import voice_pb2

        _put(
            voice_pb2.ServerMessage(
                action=voice_pb2.ActionNotice(
                    type="submitting_checkin",
                    detail=f"BP={systolic_bp}/{diastolic_bp} meds={'taken' if medication_taken else 'missed'} symptoms={','.join(symptoms) if symptoms else 'none'} weight={weight or 'N/A'}",
                )
            )
        )

        # Resolve date/time in the patient's timezone
        try:
            from zoneinfo import ZoneInfo
            patient_now = datetime.now(ZoneInfo(patient_timezone))
        except Exception:
            patient_now = datetime.now()

        resolved_date = patient_now.strftime("%Y-%m-%d")
        if entry_date and entry_date.strip():
            try:
                datetime.strptime(entry_date.strip(), "%Y-%m-%d")
                resolved_date = entry_date.strip()
            except ValueError:
                logger.warning("Invalid entry_date '%s', defaulting to today in %s", entry_date, patient_timezone)

        resolved_time = patient_now.strftime("%H:%M")
        if measurement_time and measurement_time.strip():
            mt = measurement_time.strip().lower()
            if mt in ("now", "current", "current time", "right now"):
                resolved_time = patient_now.strftime("%H:%M")
                logger.info("Resolved 'now' to %s in timezone %s", resolved_time, patient_timezone)
            else:
                resolved_time = measurement_time.strip()

        payload: dict[str, Any] = {
            "entryDate": resolved_date,
            "systolicBP": systolic_bp,
            "diastolicBP": diastolic_bp,
            "medicationTaken": medication_taken,
            "symptoms": symptoms or [],
            "notes": notes or "",
        }
        if resolved_time:
            payload["measurementTime"] = resolved_time
        if weight and weight > 0:
            payload["weight"] = weight

        saved = False
        try:
            _t = _time.time()
            logger.info("[FLOW] Step 8 — submit_checkin HTTP POST START")
            resp = requests.post(
                f"{NESTJS_URL}/daily-journal",
                headers=headers,
                json=payload,
                timeout=REQUEST_TIMEOUT,
            )
            logger.info("[FLOW] Step 8 — submit_checkin HTTP POST END (%.0fms, status=%s)", (_time.time() - _t) * 1000, resp.status_code)
            saved = resp.status_code in (200, 201, 202)
            if not saved:
                logger.warning(
                    "NestJS /daily-journal returned %s: %s",
                    resp.status_code,
                    resp.text[:200],
                )
        except requests.RequestException as exc:
            logger.error("Failed to POST /daily-journal: %s", exc)

        _put(
            voice_pb2.ServerMessage(
                checkin=voice_pb2.CheckinSaved(
                    systolic_bp=systolic_bp,
                    diastolic_bp=diastolic_bp,
                    weight=float(weight) if weight else 0.0,
                    medication_taken=medication_taken,
                    symptoms=symptoms or [],
                    saved=saved,
                )
            )
        )

        return {
            "saved": saved,
            "entry_date_used": resolved_date,
            "measurement_time_used": resolved_time,
            "message": (
                f"Check-in saved successfully for {resolved_date} at {resolved_time}. The care team has been notified."
                if saved
                else "There was a problem saving the check-in. Please try again later."
            ),
        }

    # ── Tool 2: Get recent readings ───────────────────────────────────────────

    def get_recent_readings(days: int = 7) -> dict:
        """
        Retrieve the patient's recent blood pressure readings from the database.
        Use this when the patient asks about their past readings, trends, or
        wants to know what was recorded on a specific date.

        Args:
            days: Number of days to look back (1–30). Defaults to 7.

        Returns:
            dict with 'readings' (list of entries) and 'count' (int).
        """
        days = max(1, min(30, days))
        from generated import voice_pb2 as _vpb_fetch
        _put(
            _vpb_fetch.ServerMessage(
                action=_vpb_fetch.ActionNotice(type="fetching_readings", detail=f"Fetching last {days} days")
            )
        )
        try:
            # Compute startDate/endDate — the NestJS endpoint uses these, not "days"
            from zoneinfo import ZoneInfo
            try:
                tz = ZoneInfo(patient_timezone)
            except Exception:
                tz = ZoneInfo("America/New_York")
            now = datetime.now(tz)
            start_date = (now - timedelta(days=days)).strftime("%Y-%m-%d")
            end_date = now.strftime("%Y-%m-%d")

            _t2 = _time.time()
            logger.info("[FLOW] Step 8 — get_recent_readings HTTP GET START")
            resp = requests.get(
                f"{NESTJS_URL}/daily-journal",
                headers=headers,
                params={"startDate": start_date, "endDate": end_date, "limit": "5"},
                timeout=REQUEST_TIMEOUT,
            )
            logger.info("[FLOW] Step 8 — get_recent_readings HTTP GET END (%.0fms, status=%s)", (_time.time() - _t2) * 1000, resp.status_code)
            if resp.status_code == 200:
                data = resp.json()
                entries = data if isinstance(data, list) else data.get("data", [])
                # Build a compact summary — include entry IDs for update/delete
                lines = []
                for e in entries[:5]:
                    entry_id = e.get("id", "unknown")
                    d = e.get("entryDate", "unknown")
                    t = e.get("measurementTime", "")
                    s = e.get("systolicBP", "?")
                    di = e.get("diastolicBP", "?")
                    med = "yes" if e.get("medicationTaken") else "no"
                    sym = ", ".join(e.get("symptoms", [])) if e.get("symptoms") else "none"
                    time_str = f" at {t}" if t else ""
                    lines.append(f"entry_id=\"{entry_id}\" | {d}{time_str} | BP {s}/{di} | meds {med} | symptoms: {sym}")
                summary = "\n".join(lines) if lines else "No readings found."
                logger.info("Returning %d readings to Gemini (%d chars)", len(lines), len(summary))
                return {"summary": summary, "count": len(lines)}
            else:
                logger.warning("GET /daily-journal returned %s: %s", resp.status_code, resp.text[:200])
                return {"readings": [], "count": 0}
        except requests.RequestException as exc:
            logger.error("Failed to GET /daily-journal (url=%s): %s", NESTJS_URL, exc)
            return {"summary": f"Could not fetch readings — connection to backend failed ({exc})", "count": 0}

    # ── Tool 3: Update an existing reading ────────────────────────────────────

    def update_checkin(
        entry_id: str,
        systolic_bp: int | None = None,
        diastolic_bp: int | None = None,
        medication_taken: bool | None = None,
        weight: float | None = None,
        symptoms: list[str] | None = None,
        notes: str | None = None,
        measurement_time: str | None = None,
    ) -> dict:
        """
        Update an existing blood pressure reading. Use this when the patient
        wants to correct a value they previously recorded. You MUST first call
        get_recent_readings to find the entry_id of the reading to update.
        Only include the fields that need to change.

        Args:
            entry_id:         The ID of the journal entry to update (from get_recent_readings).
            systolic_bp:      New systolic BP value (60–250), or None to keep unchanged.
            diastolic_bp:     New diastolic BP value (40–150), or None to keep unchanged.
            medication_taken: New medication status, or None to keep unchanged.
            weight:           New weight in lbs, or None to keep unchanged.
            symptoms:         New symptom list, or None to keep unchanged. ALWAYS in English.
            notes:            New notes, or None to keep unchanged. ALWAYS in English.
            measurement_time: New time in HH:mm 24-hour format, or None to keep unchanged.

        Returns:
            dict with 'updated' (bool) and 'message' (str).
        """
        payload: dict[str, Any] = {}
        if measurement_time is not None:
            payload["measurementTime"] = measurement_time
        if systolic_bp is not None:
            payload["systolicBP"] = systolic_bp
        if diastolic_bp is not None:
            payload["diastolicBP"] = diastolic_bp
        if medication_taken is not None:
            payload["medicationTaken"] = medication_taken
        if weight is not None and weight > 0:
            payload["weight"] = weight
        if symptoms is not None:
            payload["symptoms"] = symptoms
        if notes is not None:
            payload["notes"] = notes

        if not payload:
            return {"updated": False, "message": "No fields to update."}

        # Notify client that we are updating — include changed values in detail
        changes = []
        if systolic_bp is not None:
            changes.append(f"systolic={systolic_bp}")
        if diastolic_bp is not None:
            changes.append(f"diastolic={diastolic_bp}")
        if medication_taken is not None:
            changes.append(f"medication={'taken' if medication_taken else 'missed'}")
        if weight is not None and weight > 0:
            changes.append(f"weight={weight}lbs")
        if symptoms is not None:
            changes.append(f"symptoms={','.join(symptoms) if symptoms else 'none'}")
        detail_str = f"entry={entry_id} changes=[{', '.join(changes)}]"

        from generated import voice_pb2

        _put(
            voice_pb2.ServerMessage(
                action=voice_pb2.ActionNotice(
                    type="updating_checkin",
                    detail=detail_str,
                )
            )
        )

        updated = False
        try:
            _t3 = _time.time()
            logger.info("[FLOW] Step 8 — update_checkin HTTP PUT START")
            resp = requests.put(
                f"{NESTJS_URL}/daily-journal/{entry_id}",
                headers=headers,
                json=payload,
                timeout=REQUEST_TIMEOUT,
            )
            logger.info("[FLOW] Step 8 — update_checkin HTTP PUT END (%.0fms, status=%s)", (_time.time() - _t3) * 1000, resp.status_code)
            updated = resp.status_code in (200, 201, 202)
            if not updated:
                logger.warning(
                    "PUT /daily-journal/%s returned %s: %s",
                    entry_id,
                    resp.status_code,
                    resp.text[:200],
                )
        except requests.RequestException as exc:
            logger.error("Failed to PUT /daily-journal/%s: %s", entry_id, exc)

        # Fetch the updated entry to get current values
        entry_date = ""
        final_systolic = systolic_bp or 0
        final_diastolic = diastolic_bp or 0
        final_weight = weight or 0.0
        final_med = medication_taken if medication_taken is not None else False
        final_symptoms = symptoms or []

        if updated:
            try:
                get_resp = requests.get(
                    f"{NESTJS_URL}/daily-journal/{entry_id}",
                    headers=headers,
                    timeout=REQUEST_TIMEOUT,
                )
                if get_resp.status_code == 200:
                    data = get_resp.json()
                    entry_date = data.get("entryDate", "")
                    final_systolic = data.get("systolicBP", final_systolic)
                    final_diastolic = data.get("diastolicBP", final_diastolic)
                    final_weight = data.get("weight", final_weight) or 0.0
                    final_med = data.get("medicationTaken", final_med)
                    final_symptoms = data.get("symptoms", final_symptoms) or []
            except Exception:
                pass

        # Notify client of the result
        _put(
            voice_pb2.ServerMessage(
                updated=voice_pb2.CheckinUpdated(
                    entry_id=entry_id,
                    systolic_bp=int(final_systolic) if final_systolic else 0,
                    diastolic_bp=int(final_diastolic) if final_diastolic else 0,
                    weight=float(final_weight) if final_weight else 0.0,
                    medication_taken=final_med,
                    symptoms=final_symptoms,
                    updated=updated,
                    entry_date=entry_date,
                )
            )
        )

        return {
            "updated": updated,
            "message": (
                "Reading updated successfully."
                if updated
                else "Could not update the reading. Please try again."
            ),
        }

    # ── Tool 4: Delete reading(s) ───────────────────────────────────────────

    def delete_checkin(entry_ids: str) -> dict:
        """
        Delete one or more blood pressure readings. Use this when the patient
        asks to remove readings. You MUST first call get_recent_readings to find
        the entry IDs, read back the readings to the patient, and get their
        explicit confirmation before deleting.

        Supports bulk deletion — e.g. if the patient says "delete all readings
        for today", pass all matching entry IDs at once.

        Args:
            entry_ids: Comma-separated string of journal entry IDs to delete
                       (from get_recent_readings). For a single reading pass just
                       the ID (e.g. "abc123"). For multiple readings separate with
                       commas (e.g. "abc123,def456,ghi789").

        Returns:
            dict with 'deleted_count' (int), 'failed_count' (int), and 'message' (str).
        """
        from generated import voice_pb2 as _vpb_del

        # Normalise input — accept comma-separated string or a single ID
        if isinstance(entry_ids, list):
            ids = [eid.strip() for eid in entry_ids if eid.strip()]
        else:
            ids = [eid.strip() for eid in str(entry_ids).split(",") if eid.strip()]

        if not ids:
            return {"deleted_count": 0, "failed_count": 0, "message": "No entry IDs provided."}

        _put(
            _vpb_del.ServerMessage(
                action=_vpb_del.ActionNotice(
                    type="deleting_checkin",
                    detail=f"Deleting {len(ids)} entry(ies): {', '.join(ids[:5])}",
                )
            )
        )

        deleted_count = 0
        failed_count = 0
        _t4 = _time.time()
        logger.info("[FLOW] Step 8 — delete_checkin HTTP DELETE START (%d entries)", len(ids))
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
                    logger.warning(
                        "DELETE /daily-journal/%s returned %s: %s",
                        eid, resp.status_code, resp.text[:200],
                    )
            except requests.RequestException as exc:
                failed_count += 1
                logger.error("Failed to DELETE /daily-journal/%s: %s", eid, exc)

        logger.info("[FLOW] Step 8 — delete_checkin HTTP DELETE END (%.0fms, deleted=%d, failed=%d)", (_time.time() - _t4) * 1000, deleted_count, failed_count)

        if failed_count == 0:
            msg = (
                "Reading deleted successfully."
                if deleted_count == 1
                else f"All {deleted_count} readings deleted successfully."
            )
        elif deleted_count == 0:
            msg = "Could not delete the reading(s). Please try again."
        else:
            msg = f"Deleted {deleted_count} reading(s), but {failed_count} could not be deleted."

        return {"deleted_count": deleted_count, "failed_count": failed_count, "message": msg}

    return [submit_checkin, get_recent_readings, update_checkin, delete_checkin]
