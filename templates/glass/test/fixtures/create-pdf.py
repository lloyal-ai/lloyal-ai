"""Deterministic original fixture; no external documents or personal data."""
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from pathlib import Path
p=Path(__file__).with_name('inspection.pdf')
c=canvas.Canvas(str(p),pagesize=(612,792),invariant=1)
c.setTitle('Glass inspection fixture')
c.setFont('Helvetica-Bold',24);c.drawString(48,735,'A small delivery study')
c.setFont('Helvetica',12)
for y,line in [(692,'This is synthetic test material, not a real delivery service.'),(660,'Route Cedar carried 18 parcels on Monday.'),(638,'Route Willow carried 27 parcels on Monday.'),(616,'The combined parcel count was 45.'),(570,'The next page contains a diagram with no color names in its text.')]:c.drawString(48,y,line)
c.showPage();c.setFont('Helvetica-Bold',24);c.drawString(48,735,'Two markers')
c.setFont('Helvetica',12);c.drawString(48,692,'Inspect the diagram and describe the colors and positions.')
c.setFillColor(HexColor('#1463e7'));c.circle(174,450,62,stroke=0,fill=1)
c.setFillColor(HexColor('#e74330'));c.rect(336,388,124,124,stroke=0,fill=1)
c.setFillColor(HexColor('#111111'));c.setFont('Helvetica',14);c.drawCentredString(174,350,'Marker A');c.drawCentredString(398,350,'Marker B')
c.save()
# A separate supported image-bearing PDF keeps the vector-gating failure intact.
# Pillow draws the same controlled shapes; no outside asset is used.
from reportlab.lib.utils import ImageReader
from PIL import Image, ImageDraw
from io import BytesIO
image=Image.new('RGB',(600,240),'white');draw=ImageDraw.Draw(image)
draw.ellipse((45,45,195,195),fill='#1463e7');draw.rectangle((350,45,500,195),fill='#e74330')
b=BytesIO();image.save(b,format='PNG');b.seek(0)
c=canvas.Canvas(str(p.with_name('inspection-image.pdf')),pagesize=(612,792),invariant=1)
c.setTitle('Glass image inspection fixture');c.setFont('Helvetica-Bold',24);c.drawString(48,735,'Two markers')
c.setFont('Helvetica',12);c.drawString(48,690,'Describe the shapes and colors. Marker A is left; Marker B is right.')
c.drawImage(ImageReader(b),48,370,width=516,height=206.4)
c.drawCentredString(151,340,'Marker A');c.drawCentredString(413,340,'Marker B');c.save()
