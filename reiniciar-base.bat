@echo off
REM ============================================================
REM  Japp - Borrar la base y crearla de nuevo con los datos iniciales (tienda JC01)
REM  BORRA TODO: ventas, facturas, cierres y cadena VeriFactu. Solo para pruebas.
REM  Uso: doble clic, o desde CMD:  reiniciar-base.bat
REM ============================================================

REM ---- Cambia estos valores si tu instalacion es distinta ----
set "PGBIN=C:\Program Files\PostgreSQL\16\bin"
set "BASE=japp"
set "DUENO=sa"
set "PROYECTO=%~dp0"
REM ------------------------------------------------------------

setlocal
cd /d "%PROYECTO%"
echo.
echo  Japp - reiniciar la base de datos
echo  ---------------------------------
echo  Base de datos : %BASE%   (dueno: %DUENO%)
echo  PostgreSQL    : %PGBIN%
echo  Proyecto      : %CD%
echo.

if not exist "%PGBIN%\psql.exe" (
  echo  [X] No encuentro psql.exe en "%PGBIN%". Cambia PGBIN al principio de este archivo.
  goto :fin
)
if not exist "japp-api\package.json" (
  echo  [X] Este archivo tiene que estar en la carpeta del proyecto, junto a japp-api y japp-db.
  goto :fin
)
if not exist "japp-db\.env" (
  echo  [X] Falta japp-db\.env. Copialo de japp-db\.env.example y pon tu DATABASE_URL.
  goto :fin
)
findstr /R /C:"^DATABASE_URL=.*/%BASE%$" /C:"^DATABASE_URL=.*/%BASE%?" "japp-db\.env" >nul
if errorlevel 1 (
  echo  [X] japp-db\.env no apunta a la base "%BASE%". Revisa su linea DATABASE_URL
  echo      o cambia BASE al principio de este archivo.
  goto :fin
)

echo  ATENCION: se borrara TODO lo que hay en la base "%BASE%".
echo  Cierra antes la API y el agente (Ctrl+C en sus ventanas).
echo.
set /p OK= Escribe BORRAR para continuar: 
if /I not "%OK%"=="BORRAR" (
  echo  Cancelado. No se ha tocado nada.
  goto :fin
)

echo.
echo  [1/3] Borrando y creando la base (pedira la clave de postgres)...
"%PGBIN%\psql.exe" -U postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS %BASE% WITH (FORCE)" -c "CREATE DATABASE %BASE% OWNER %DUENO%"
if errorlevel 1 (
  echo  [X] No se ha podido borrar o crear la base. Revisa la clave de postgres y que exista el usuario %DUENO%.
  goto :fin
)

echo.
echo  [2/3] Cargando esquema, migraciones y datos iniciales...
set "SEED=1"
cd /d "%PROYECTO%japp-api"
call npm run db:init
if errorlevel 1 (
  echo  [X] Fallo al crear la base. Copia el mensaje de arriba y pasaselo a Claude.
  goto :fin
)
set "SEED="

echo.
echo  [3/3] Listo. Ahora:
echo    1. Arranca la API:      cd "%PROYECTO%japp-api"  y  npm start
echo    2. Arranca el agente:   en otra ventana,  npm start -w sync-agent
echo    3. En cada TPV y PDA:   "Resetear equipo", Ctrl+F5 y configura la CAJA1
echo    Usuarios de prueba: Sistemas, Jeison, Barra, Mesero, Capitan Mesero (PIN 7070).
echo    Cambia todos los PIN antes de abrir al publico.

:fin
echo.
pause
endlocal
