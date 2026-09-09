@echo off
node "%~dp0build.cjs" --bump %* --deploy
