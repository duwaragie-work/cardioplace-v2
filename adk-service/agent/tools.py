"""
Tool functions for the Healplace Cardio ADK agent.

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
) -> list:
    """
    Return the list of ADK tool functions for a single voice session.

    Each tool is a closure that captures:
    - auth_token: JWT used to call the NestJS REST API
    - out_queue:  asyncio.Queue for pushing ServerMessages back to the gRPC stream
    - loop:       The running event loop (needed for thread-safe queue puts)
    """

    def _put(msg: Any) -> None:
        """Thread-safe put into the async out_queue."""
        asyncio.run_coroutine_threadsafe(out_queue.put(msg), loop)

    def submit_checkin(
        systolic_bp: int,
        diastolic_bp: int,
        medication_taken: bool,
        weight: float = 0.0,
        symptoms: list[str] | None = None,
        notes: str = "",
        entry_date: str = "",
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
            symptoms:         List of symptoms the patient reported.
            notes:            Any extra notes the patient mentioned.
            entry_date:       Date of the reading in YYYY-MM-DD format. Defaults
                              to today if not provided or blank.

        Returns:
            dict with 'saved' (bool) and 'message' (str).
        """
        # Notify client that we are saving
        from generated import voice_pb2  # imported here to avoid circular at module load

        _put(
            voice_pb2.ServerMessage(
                action=voice_pb2.ActionNotice(
                    type="submitting_checkin",
                    detail="Saving your check-in…",
                )
            )
        )

        # Resolve entry date — fall back to today if blank or invalid
        resolved_date = datetime.now().strftime("%Y-%m-%d")
        if entry_date and entry_date.strip():
            try:
                datetime.strptime(entry_date.strip(), "%Y-%m-%d")
                resolved_date = entry_date.strip()
            except ValueError:
                logger.warning("Invalid entry_date '%s', defaulting to today", entry_date)

        payload: dict[str, Any] = {
            "entryDate": resolved_date,
            "systolicBP": systolic_bp,
            "diastolicBP": diastolic_bp,
            "medicationTaken": medication_taken,
            "symptoms": symptoms or [],
            "notes": notes or "",
        }
        if weight and weight > 0:
            payload["weight"] = weight

        saved = False
        try:
            resp = requests.post(
                f"{NESTJS_URL}/daily-journal",
                headers={"Authorization": f"Bearer {auth_token}"},
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

        # Notify client of the result
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

    return [submit_checkin]
