"""
genera-icone.py — Genera le icone PNG dell'app (stesso disegno di icons/icona.svg)
usando solo la libreria standard di Python (nessuna installazione).

Uso:  python tools/genera-icone.py
"""
import os
import struct
import zlib

BLU = (0x1F, 0x4E, 0x79)
BIANCO = (0xFF, 0xFF, 0xFF)
AZZURRO = (0x9C, 0xC3, 0xE6)

# Disegno su una griglia 64x64 (come l'SVG): rettangoli arrotondati (x, y, w, h, raggio, colore).
BARRE = [
    (12, 16, 30, 7, 3.5, BIANCO),
    (22, 29, 30, 7, 3.5, AZZURRO),
    (12, 42, 20, 7, 3.5, BIANCO),
]


def dentro_rett(px, py, x, y, w, h, r):
    """True se il punto (px, py) è dentro il rettangolo arrotondato."""
    if px < x or px > x + w or py < y or py > y + h:
        return False
    cx = min(max(px, x + r), x + w - r)
    cy = min(max(py, y + r), y + h - r)
    return (px - cx) ** 2 + (py - cy) ** 2 <= r * r


def colore(px, py, maskable):
    """Colore (r, g, b, a) del punto in coordinate 0..64."""
    if maskable:
        # Icona "maskable": sfondo pieno e disegno ridotto nella zona sicura (80%).
        qx, qy = 32 + (px - 32) / 0.8, 32 + (py - 32) / 0.8
    else:
        qx, qy = px, py
        if not dentro_rett(px, py, 0, 0, 64, 64, 14):
            return (0, 0, 0, 0)
    for (x, y, w, h, r, c) in BARRE:
        if dentro_rett(qx, qy, x, y, w, h, r):
            return c + (255,)
    return BLU + (255,)


def genera(lato, maskable, percorso):
    campioni = 4  # 4x4 sotto-campioni per pixel: bordi smussati
    righe = bytearray()
    s = 64 / lato
    for j in range(lato):
        righe.append(0)  # filtro PNG "nessuno"
        for i in range(lato):
            acc = [0, 0, 0, 0]
            for sj in range(campioni):
                for si in range(campioni):
                    c = colore((i + (si + 0.5) / campioni) * s, (j + (sj + 0.5) / campioni) * s, maskable)
                    a = c[3]
                    acc[0] += c[0] * a
                    acc[1] += c[1] * a
                    acc[2] += c[2] * a
                    acc[3] += a
            n = campioni * campioni
            alfa = acc[3] / n
            if acc[3]:
                righe += bytes([round(acc[0] / acc[3]), round(acc[1] / acc[3]), round(acc[2] / acc[3]), round(alfa)])
            else:
                righe += bytes([0, 0, 0, 0])

    def blocco(tipo, dati):
        return struct.pack('>I', len(dati)) + tipo + dati + struct.pack('>I', zlib.crc32(tipo + dati) & 0xFFFFFFFF)

    png = b'\x89PNG\r\n\x1a\n'
    png += blocco(b'IHDR', struct.pack('>IIBBBBB', lato, lato, 8, 6, 0, 0, 0))
    png += blocco(b'IDAT', zlib.compress(bytes(righe), 9))
    png += blocco(b'IEND', b'')
    with open(percorso, 'wb') as f:
        f.write(png)
    print('creato', percorso)


if __name__ == '__main__':
    cartella = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'icons')
    genera(192, False, os.path.join(cartella, 'icona-192.png'))
    genera(512, False, os.path.join(cartella, 'icona-512.png'))
    genera(512, True, os.path.join(cartella, 'icona-maskable-512.png'))
