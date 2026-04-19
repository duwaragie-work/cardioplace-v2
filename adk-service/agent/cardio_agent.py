"""
Cardioplace ADK agent factory.

Creates a per-session Agent with the correct system prompt, language,
and tool set.
"""

import asyncio
import logging
import os

from google.adk.agents import Agent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService

from .prompts import build_prompt
from .tools import make_tools

logger = logging.getLogger(__name__)

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash-live-preview-04-09")
APP_NAME = "healplace_cardio"


def create_session_runner(
    user_id: str,
    mode: str,
    patient_context: str,
    auth_token: str,
    out_queue: asyncio.Queue,
    loop: asyncio.AbstractEventLoop,
) -> tuple["Runner", "InMemorySessionService"]:
    """
    Build an ADK Runner + SessionService for a single voice session.

    Returns (runner, session_service) so the caller can create a session
    and call runner.run_live().
    """
    # Extract timezone from patient context
    import re
    tz_match = re.search(r'patient timezone (\S+)\)', patient_context)
    patient_tz = tz_match.group(1) if tz_match else "America/New_York"
    tools = make_tools(auth_token, out_queue, loop, patient_timezone=patient_tz)
    instruction = build_prompt(mode, patient_context)

    # Diagnostic: set DISABLE_TOOLS=1 to prove whether tool declarations are
    # the source of Gemini's 1008 "Operation is not implemented" close. If
    # the session survives past a user utterance with tools off but dies
    # with them on, the tool-declaration format is the culprit.
    disable_tools = os.getenv("DISABLE_TOOLS", "") == "1"
    if disable_tools:
        logger.warning("DISABLE_TOOLS=1 — creating agent with NO tools (diagnostic mode)")

    agent = Agent(
        name="cardio_voice_agent",
        model=GEMINI_MODEL,
        instruction=instruction,
        tools=[] if disable_tools else tools,
    )

    session_service = InMemorySessionService()
    runner = Runner(
        agent=agent,
        app_name=APP_NAME,
        session_service=session_service,
    )

    logger.debug(
        "Created agent [user=%s model=%s mode=%s]",
        user_id,
        GEMINI_MODEL,
        mode,
    )
    return runner, session_service
