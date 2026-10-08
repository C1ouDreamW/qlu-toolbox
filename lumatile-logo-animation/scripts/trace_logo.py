from pathlib import Path
import cv2
import numpy as np
from PIL import Image

# Extract the animated vector outlines; the final still uses this same PNG.
root = Path(__file__).resolve().parents[1]
image = np.array(Image.open(root / 'public/lumatile.png').convert('RGBA'))
count, labels, stats, _ = cv2.connectedComponentsWithStats((image[:, :, 3] > 127).astype('uint8'))
names = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft', 'lineTop', 'lineMiddle', 'lineBottom', 'bottomBar']
components = [i for i in range(1, count) if stats[i, 4] > 50]
assert len(components) == len(names), 'Reference should contain exactly eight separate shapes'
lines = ['// Traced from public/lumatile.png in its original 512 x 512 coordinate space.', 'export const shapes = {']
for name, label in zip(names, components):
    x, y, w, h, _ = stats[label]
    isolated = np.where(labels == label, image[:, :, 3], 0).astype('uint8')
    enlarged = cv2.resize(isolated, None, fx=8, fy=8, interpolation=cv2.INTER_LINEAR)
    contours, _ = cv2.findContours((enlarged > 127).astype('uint8'), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    contour = cv2.approxPolyDP(max(contours, key=cv2.contourArea), 0.8, True).reshape(-1, 2)
    points = (contour.astype(float) + 0.5) / 8
    path = 'M' + ' L'.join(f'{px:.3f},{py:.3f}' for px, py in points) + ' Z'
    interior = cv2.erode((labels == label).astype('uint8'), np.ones((5, 5), dtype='uint8')) > 0
    colors = []
    for low, high in [(y, y+h/3), (y+h/3, y+2*h/3), (y+2*h/3, y+h)]:
        rows = np.arange(image.shape[0])[:, None]
        pixels = image[:, :, :3][interior & (rows >= low) & (rows < high)]
        rgb = np.median(pixels, axis=0).astype(int)
        colors.append('#' + ''.join(f'{v:02x}' for v in rgb))
    lines.extend([f'  {name}: {{', f'    path: "{path}",', f'    center: [{x+w/2}, {y+h/2}],', f'    bounds: [{x}, {y}, {w}, {h}],', f'    colors: {colors!r},', '  },'])
    print(name, 'nodes=', len(points), 'bounds=', (x,y,w,h), 'colors=', colors)
lines.extend(['} as const;', 'export type ShapeName = keyof typeof shapes;', ''])
(root / 'src/logoGeometry.ts').write_text('\n'.join(lines), encoding='utf-8')
