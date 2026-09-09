#!/usr/bin/env python3
"""Erzeugt das App-Icon als PNG - ohne Fremdbibliotheken.

Motiv: eine Schnitt-Timeline. Drei Spuren auf dunklem Grund, die mittlere
in Bernstein herausgehoben - dieselbe Farblogik wie in der App.
"""
import struct, zlib, os

GRUND  = (0x1C, 0x18, 0x13)
BERN   = (0xD8, 0x96, 0x3E)
GEDECKT= (0x4A, 0x42, 0x36)
HELL   = (0xFA, 0xF6, 0xEF)


def png(pfad, groesse):
    n = groesse
    # Leinwand
    px = [[GRUND for _ in range(n)] for _ in range(n)]

    def kasten(x0, y0, x1, y1, farbe, radius=0):
        for y in range(max(0, y0), min(n, y1)):
            for x in range(max(0, x0), min(n, x1)):
                if radius:
                    dx = min(x - x0, x1 - 1 - x)
                    dy = min(y - y0, y1 - 1 - y)
                    if dx < radius and dy < radius:
                        if (radius - dx) ** 2 + (radius - dy) ** 2 > radius * radius:
                            continue
                px[y][x] = farbe

    e = n / 16.0          # Einheit
    r = int(e * 0.55)     # Eckenradius der Balken

    # drei Spuren, die mittlere ist die Heldenspur
    spuren = [
        (int(e * 3.4), int(e * 1.0), int(e * 4.6), GEDECKT),
        (int(e * 6.6), int(e * 1.0), int(e * 11.4), BERN),
        (int(e * 9.8), int(e * 1.0), int(e * 7.2), GEDECKT),
    ]
    for oben, hoehe_e, breite, farbe in spuren:
        kasten(int(e * 2.4), oben, int(e * 2.4) + breite, oben + int(e * 1.9), farbe, r)

    # Abspielkopf: senkrechte helle Linie
    kx = int(e * 11.9)
    kasten(kx, int(e * 2.2), kx + max(2, int(e * 0.30)), int(e * 13.4), HELL)

    # PNG schreiben
    roh = b"".join(b"\x00" + bytes(v for p in reihe for v in p) for reihe in px)

    def chunk(typ, daten):
        c = struct.pack(">I", len(daten)) + typ + daten
        return c + struct.pack(">I", zlib.crc32(typ + daten) & 0xFFFFFFFF)

    with open(pfad, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", n, n, 8, 2, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(roh, 9)))
        f.write(chunk(b"IEND", b""))
    print(f"  {os.path.basename(pfad)}  {n}x{n}  {os.path.getsize(pfad)} Bytes")


if __name__ == "__main__":
    hier = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for name, gr in [("icon-192.png", 192), ("icon-512.png", 512), ("apple-touch-icon.png", 180)]:
        png(os.path.join(hier, name), gr)
