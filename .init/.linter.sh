#!/bin/bash
cd /tmp/kavia/workspace/code-generation/carrom-practice-board-239658-239762/carrom_game_frontend
npm run build
EXIT_CODE=$?
if [ $EXIT_CODE -ne 0 ]; then
   exit 1
fi

