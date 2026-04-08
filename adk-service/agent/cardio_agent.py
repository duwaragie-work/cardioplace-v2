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

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.1-flash-live-preview")
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
    tools = make_tools(auth_token, out_queue, loop)
    instruction = build_prompt(mode, patient_context)

    agent = Agent(
        name="cardio_voice_agent",
        model=GEMINI_MODEL,
        instruction=instruction,
        tools=tools,
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
