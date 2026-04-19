"""
Diagnostic: list every model your GEMINI_API_KEY can access, highlighting
the ones that support bidiGenerateContent (Live API).

    python list_models.py
"""

import os
import sys
from dotenv import load_dotenv

load_dotenv()

api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
if not api_key:
    print("No GEMINI_API_KEY / GOOGLE_API_KEY in environment.")
    sys.exit(1)

from google import genai

client = genai.Client(api_key=api_key)

print(f"{'model':<60} bidi  streamGen  generate")
print("-" * 90)
live_models = []
for m in client.models.list():
    methods = getattr(m, "supported_actions", None) or getattr(m, "supported_generation_methods", []) or []
    bidi = "bidiGenerateContent" in methods
    stream = "streamGenerateContent" in methods
    gen = "generateContent" in methods
    mark = "  ✓  " if bidi else "     "
    stream_mark = "   ✓     " if stream else "         "
    gen_mark = "   ✓   " if gen else "       "
    print(f"{m.name:<60} {mark} {stream_mark} {gen_mark}")
    if bidi:
        live_models.append(m.name)

print("\nLive-capable (bidiGenerateContent) models available to this key:")
for name in live_models:
    print(f"  {name}")
