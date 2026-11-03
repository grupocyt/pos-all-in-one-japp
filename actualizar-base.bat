@echo off
REM ============================================================
REM  Japp - Actualizar la estructura de la base SIN borrar nada
REM  Aplica solo las migraciones pendientes (japp-db\migrations).
REM  Conserva ventas, facturas, cierres, usuarios, carta y cadena VeriFactu.
REM  Antes hace una copia de seguridad en la carpeta backups.
REM  Uso: doble clic, o desde CMD:  actualizar-base.bat
REM ============================================================

REM ---- Cambia estos valores si tu instalacion es distinta ----
set "PGBIN=C:\Program Files\PostgreSQL\16\bin"
set "BASE=japp"
set "PROYECTO=%~dp0"
REM ------------------------------------------------------------

setlocal
cd /d "%PROYECTO%"
echo.
echo  Japp - actualizar la base de datos (sin borrar nada)
echo  ----------------------------------------------------
echo  Base de datos : %BASE%
echo  PostgreSQL    : %PGBIN%
echo  Proyecto      : %CD%
echo.

if not exist "%PGBIN%\pg_dump.exe" (
  echo  [X] No encuentro pg_dump.exe en "%PGBIN%". Cambia PGBIN al principio de este archivo.
  goto :fin
)
if not exist "japp-db\package.json" (
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

echo  Antes:
"%PGBIN%\psql.exe" "%DBURL%" -At -c "SELECT '   ultima migracion aplicada: ' || coalesce(max(version),'ninguna') FROM schema_migrations"
if errorlevel 1 (
  echo  [X] No puedo conectar con la base. Arranca PostgreSQL y revisa DATABASE_URL en japp-db\.env.
  goto :fin
)
echo.
echo  Se aplicaran solo las migraciones que falten. No se borra ni se cambia ningun dato.
echo  Cierra antes la API y el agente (Ctrl+C en sus ventanas).
echo.
set /p OK= Escribe SI para continuar:
if /I not "%OK%"=="SI" (
  echo  Cancelado. No se ha tocado nada.
  goto :fin
)

echo.
echo  [1/3] Copia de seguridad...
if not exist "backups" mkdir "backups"
set "STAMP="
for /f %%d in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmm"') do set "STAMP=%%d"
if not defined STAMP set "STAMP=copia"
set "COPIA=backups\%BASE%-antes-de-actualizar-%STAMP%.dump"
"%PGBIN%\pg_dump.exe" --dbname="%DBURL%" -Fc -f "%COPIA%"
if errorlevel 1 (
  echo  [X] No se ha podido hacer la copia. No se actualiza nada.
  goto :fin
)
echo      Guardada en %COPIA%

echo.
echo  [2/3] Aplicando migraciones pendientes...
set "SEED="
cd /d "%PROYECTO%japp-db"
if not exist "node_modules" (
  echo      Instalando dependencias de japp-db la primera vez...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo  [X] Fallo npm install en japp-db. Copia el mensaje de arriba y pasaselo a Claude.
    goto :fin
  )
)
call npm run db:migrate
if errorlevel 1 (
  echo.
  echo  [X] Fallo una migracion. La base se queda como estaba antes de esa migracion
  echo      ^(cada una va en su propia transaccion^). Copia el mensaje de arriba y pasaselo a Claude.
  echo      La copia de antes de empezar esta en %COPIA%: no la borres.
  goto :fin
)
cd /d "%PROYECTO%"

echo.
echo  [3/3] Listo.
"%PGBIN%\psql.exe" "%DBURL%" -At -c "SELECT '   ultima migracion aplicada: ' || max(version) FROM schema_migrations"
echo.
echo  Ahora:
echo    1. Arranca la API:      cd "%PROYECTO%japp-api"  y  npm start
echo    2. Arranca el agente:   en otra ventana,  npm start -w sync-agent
echo    3. En cada TPV y PDA:   Ctrl+F5 (no hace falta "Resetear equipo")
echo    La copia de antes de actualizar esta en %COPIA%

:fin
echo.
pause
endlocal
