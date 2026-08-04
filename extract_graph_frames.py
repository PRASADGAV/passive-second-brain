import cv2
from pathlib import Path

src = Path('graph_design.mp4')
out_dir = Path('graph_frames')
out_dir.mkdir(exist_ok=True)
cap = cv2.VideoCapture(str(src))
if not cap.isOpened():
    raise SystemExit('video open failed')
idx = 0
count = 0
while True:
    ok, frame = cap.read()
    if not ok:
        break
    if count % 10 == 0:
        path = out_dir / f'frame_{idx:03d}.png'
        cv2.imwrite(str(path), frame)
        idx += 1
    count += 1
cap.release()
print(f'extracted {idx} frames')
