"""
Tool functions for the Cardioplace ADK agent.

These functions are called by the Gemini model via ADK's function-calling mechanism.
Each tool closure captures the auth_token and loop/queue needed to notify the gRPC
stream when a tool completes.
"""

import asyncio
import logging
import os
from datetime import datetime
from typing import Any

import requests

logger = logging.getLogger(__name__)

NESTJS_URL = os.getenv("NESTJS_INTERNAL_URL", "http://localhost:8080/api")
REQUEST_TIMEOUT = 15  # seconds


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
            resp = requests.post(
                f"{NESTJS_URL}/daily-journal",
                headers=headers,
                json=payload,
                timeout=REQUEST_TIMEOUT,
            )
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
            "message": (
                "Check-in saved successfully. The care team has been notified."
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
            resp = requests.get(
                f"{NESTJS_URL}/daily-journal",
                headers=headers,
                params={"days": days},
                timeout=REQUEST_TIMEOUT,
            )
            if resp.status_code == 200:
                data = resp.json()
                entries = data if isinstance(data, list) else data.get("data", [])
                readings = []
                for e in entries[:15]:
                    readings.append({
                        "id": e.get("id", ""),
                        "date": e.get("entryDate", ""),
                        "measurement_time": e.get("measurementTime"),
                        "systolic": e.get("systolicBP"),
                        "diastolic": e.get("diastolicBP"),
                        "weight": e.get("weight"),
                        "medication_taken": e.get("medicationTaken"),
                        "symptoms": e.get("symptoms", []),
                    })
                return {"readings": readings, "count": len(readings)}
            else:
                logger.warning("GET /daily-journal returned %s", resp.status_code)
                return {"readings": [], "count": 0}
        except requests.RequestException as exc:
            logger.error("Failed to GET /daily-journal: %s", exc)
            return {"readings": [], "count": 0}

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
        detail_str = f"entry={entry_id or entry_date or 'unknown'} changes=[{', '.join(changes)}]"

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
            resp = requests.put(
                f"{NESTJS_URL}/daily-journal/{entry_id}",
                headers=headers,
                json=payload,
                timeout=REQUEST_TIMEOUT,
            )
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

    # ── Tool 4: Delete a reading ──────────────────────────────────────────────

    def delete_checkin(entry_id: str) -> dict:
        """
        Delete a blood pressure reading. Use this only when the patient
        explicitly asks to remove a specific reading. You MUST first call
        get_recent_readings to find the entry_id, confirm the date and values
        with the patient, and get their explicit confirmation before deleting.

        Args:
            entry_id: The ID of the journal entry to delete (from get_recent_readings).

        Returns:
            dict with 'deleted' (bool) and 'message' (str).
        """
        from generated import voice_pb2 as _vpb_del
        _put(
            _vpb_del.ServerMessage(
                action=_vpb_del.ActionNotice(type="deleting_checkin", detail=f"Deleting entry {entry_id}")
            )
        )
        try:
            resp = requests.delete(
                f"{NESTJS_URL}/daily-journal/{entry_id}",
                headers=headers,
                timeout=REQUEST_TIMEOUT,
            )
            deleted = resp.status_code in (200, 204)
            if not deleted:
                logger.warning(
                    "DELETE /daily-journal/%s returned %s: %s",
                    entry_id,
                    resp.status_code,
                    resp.text[:200],
                )
            return {
                "deleted": deleted,
                "message": (
                    "Reading deleted successfully."
                    if deleted
                    else "Could not delete the reading. Please try again."
                ),
            }
        except requests.RequestException as exc:
            logger.error("Failed to DELETE /daily-journal/%s: %s", entry_id, exc)
            return {"deleted": False, "message": "Could not connect to the server."}

    return [submit_checkin, get_recent_readings, update_checkin, delete_checkin]
