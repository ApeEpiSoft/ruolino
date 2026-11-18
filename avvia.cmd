@echo off
rem ===========================================================================
rem  Avvia Ruolino in locale: server web statico (Python) + apertura browser.
rem  Chiudere questa finestra per fermare il server.
rem ===========================================================================
cd /d "%~dp0"
echo Ruolino in esecuzione su http://localhost:8000  (chiudi questa finestra per fermarlo)
start "" http://localhost:8000/
python -m http.server 8000 --bind 127.0.0.1
