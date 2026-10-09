# rcheevos (vendored)

Fuentes oficiales de [RetroAchievements/rcheevos](https://github.com/RetroAchievements/rcheevos) **v11.6.0**.

Blaze compila solo el módulo **rhash** (`src/rhash` + `rc_compat.c`) para el hashing oficial PS2 (`rc_hash_generate_from_file` + `RC_CONSOLE_PLAYSTATION_2`).

Antes de hashear hay que llamar `rc_hash_init_default_cdreader()` (PS1/PS2/PSP usan el cdreader).

La consola la pasa Blaze (`consoleKey` / `consoleId` desde `Game.platform`); PCSX2 fuerza PS2.

Licencia: ver `LICENSE` en este directorio.
