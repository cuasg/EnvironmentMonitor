#!/bin/bash
cd ~/plant
git fetch origin
git reset --hard origin/majorupdate1
source venv/bin/activate
pip install -r backend/requirements.txt
sudo systemctl restart api
