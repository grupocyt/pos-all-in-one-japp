@echo off
REM ============================================================
REM  Japp - Quitar las mesas de ejemplo SIN borrar nada mas
REM  Las crearon los datos iniciales antiguos: SALON 101-199 y TERRAZA 201-399.
REM  Deja la 100 y la 200. Las que tienen pedidos no se borran: se dan de baja (no se pierde el historial).
REM  Conserva ventas, facturas, cierres, usuarios y carta.
REM  Uso: doble clic, o desde CMD:  limpiar-mesas.bat
REM ============================================================

REM ---- Cambia estos valores si tu instalacion es distinta ----
set "PGBIN=C:\Program Files\PostgreSQL\16\bin"
set "BASE=japp"
set "PROYECTO=%~dp0"
REM ------------------------------------------------------------

setlocal
chcp 1252 >nul
cd /d "%PROYECTO%"
echo.
echo  Japp - quitar las mesas de ejemplo
echo  ----------------------------------
echo  Base de datos : %BASE%
echo  PostgreSQL    : %PGBIN%
echo  Proyecto      : %CD%
echo.

if not exist "%PGBIN%\psql.exe" (
  echo  [X] No encuentro psql.exe en "%PGBIN%". Cambia PGBIN al principio de este archivo.
  goto :fin
)
if not exist "japp-db\sql\limpiar-mesas-ejemplo.sql" (
  echo  [X] Este archivo tiene que estar en la carpeta del proyecto, junto a japp-api y japp-db.
  goto :fin
)
if not exist "japp-db\.env" (
  echo  [X] Falta japp-db\.env. Copialo de japp-db\.env.example y pon tu DATABASE_URL.
  goto :fin
)
set "DBURL="
for /f "usebackq tokens=1,* delims==" %%a in (`findstr /B /C:"DATABASE_URL=" "japp-db\.env"`) do set "DBURL=%%b"
if not defined DBURL (
  echo  [X] japp-db\.env no tiene la linea DATABASE_URL.
  goto :fin
)
findstr /R /C:"^DATABASE_URL=.*/%BASE%$" /C:"^DATABASE_URL=.*/%BASE%?" "japp-db\.env" >nul
if errorlevel 1 (
  echo  [X] japp-db\.env no apunta a la base "%BASE%". Revisa su linea DATABASE_URL
  echo      o cambia BASE al principio de este archivo.
  goto :fin
)

echo  Mesas ahora (por sala):
"%PGBIN%\psql.exe" -X -w -A -t -F " : " -c "SELECT '   ' || a.name, count(*) || ' mesas' FROM dining_table t JOIN area a ON a.id = t.area_id WHERE t.active GROUP BY a.name, a.sort_order ORDER BY a.sort_order" -d "%DBURL%"
if errorlevel 1 (
  echo  [X] No puedo conectar con la base. Arranca PostgreSQL y revisa DATABASE_URL en japp-db\.env.
  goto :fin
)
echo.
echo  Se quitaran las mesas SALON 101-199 y TERRAZA 201-399. Las demas no se tocan.
echo  Cierra antes la API y el agente (Ctrl+C en sus ventanas).
echo.
set /p OK= Escribe SI para continuar: 
if /I not "%OK%"=="SI" (
  echo  Cancelado. No se ha tocado nada.
  goto :fin
)

echo.
"%PGBIN%\psql.exe" -X -w -q -v ON_ERROR_STOP=1 -f "japp-db\sql\limpiar-mesas-ejemplo.sql" -d "%DBURL%"
if errorlevel 1 (
  echo  [X] No se ha podido. No se ha cambiado nada. Copia el mensaje de arriba y pasaselo a Claude.
  goto :fin
)
echo.
echo  Mesas despues (por sala):
"%PGBIN%\psql.exe" -X -w -A -t -F " : " -c "SELECT '   ' || a.name, count(*) || ' mesas' FROM dining_table t JOIN area a ON a.id = t.area_id WHERE t.active GROUP BY a.name, a.sort_order ORDER BY a.sort_order" -d "%DBURL%"
echo.
echo  Listo. Arranca la API. Cada caja y PDA quita esas mesas al volver a entrar (1.2.278 o posterior).

:fin
echo.
pause
endlocal
