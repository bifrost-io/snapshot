#!/bin/bash

cd /home/ubuntu/sora/snapshot/scripts
node index.js 0 "../snapshots/vdot-$(date +"%Y-%m-%d").json"
node vsdot.js 0 "../snapshots/salp-vsdot-$(date +"%Y-%m-%d").json"
cd ..
git add .
git commit -m "Auto upload $(date +"%Y-%m-%d %T")"
git push origin main
