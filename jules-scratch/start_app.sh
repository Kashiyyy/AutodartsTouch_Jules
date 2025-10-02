#!/bin/bash
set -e
cd AutodartsTouch
xvfb-run -a npx electron . --no-sandbox --disable-gpu --remote-debugging-port=9222 > ../app.log 2>&1