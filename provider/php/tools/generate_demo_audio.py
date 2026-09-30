#!/usr/bin/env python3
"""Generate the three original, synthetic WAV files used by the demo provider."""
from array import array
from math import pi, sin
from pathlib import Path
import sys
import wave

SAMPLE_RATE = 8000
OUTPUT = Path(__file__).resolve().parents[1] / 'audio'
EPISODES = [
    ('willkommen.wav', 14, 330),
    ('zehn-sekunden.wav', 18, 440),
    ('bewusst-hoeren.wav', 24, 262),
]


def generate(path: Path, seconds: int, frequency: int) -> None:
    with wave.open(str(path), 'wb') as file:
        file.setnchannels(1)
        file.setsampwidth(2)
        file.setframerate(SAMPLE_RATE)
        for second in range(seconds):
            samples = array('h')
            for index in range(SAMPLE_RATE):
                time = second + index / SAMPLE_RATE
                active = second % 6 in (0, 1)
                fade = min(index / 400, 1, (SAMPLE_RATE - index) / 400)
                value = int(2500 * fade * sin(2 * pi * frequency * time)) if active else 0
                samples.append(value)
            if sys.byteorder != 'little':
                samples.byteswap()
            file.writeframes(samples.tobytes())


if __name__ == '__main__':
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for filename, seconds, frequency in EPISODES:
        generate(OUTPUT / filename, seconds, frequency)
