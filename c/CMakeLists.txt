cmake_minimum_required(VERSION 3.16)
project(orrery_spice_ref C)

# CSPICE (NAIF's C toolkit) is not in the repo. Point CSPICE_ROOT at the
# unpacked toolkit (the folder holding include/ and lib/cspice.a).
set(CSPICE_ROOT "$ENV{HOME}/.local/share/naif/cspice" CACHE PATH "CSPICE toolkit root")

if(NOT EXISTS "${CSPICE_ROOT}/lib/cspice.a")
  message(FATAL_ERROR "cspice.a not found under ${CSPICE_ROOT}/lib. "
                      "Download CSPICE (see c/README.md) or pass -DCSPICE_ROOT=...")
endif()

add_executable(orrery_spice_ref orrery_spice_ref.c)
target_include_directories(orrery_spice_ref PRIVATE "${CSPICE_ROOT}/include")
target_link_libraries(orrery_spice_ref PRIVATE "${CSPICE_ROOT}/lib/cspice.a" m)
target_compile_options(orrery_spice_ref PRIVATE -O2 -Wall -Wextra)
# The tool loads python/data/metakernel.tm, whose kernel paths are relative to python/.
target_compile_definitions(orrery_spice_ref PRIVATE
  ORRERY_PYTHON_DIR="${CMAKE_CURRENT_SOURCE_DIR}/../python")

# The Artemis II reference (docs/validation/artemis2.md): Orion's
# reconstructed trajectory sampled from NAIF's SPK.
add_executable(artemis2_ref artemis2_ref.c)
target_include_directories(artemis2_ref PRIVATE "${CSPICE_ROOT}/include")
target_link_libraries(artemis2_ref PRIVATE "${CSPICE_ROOT}/lib/cspice.a" m)
target_compile_options(artemis2_ref PRIVATE -O2 -Wall -Wextra)
target_compile_definitions(artemis2_ref PRIVATE
  ORRERY_PYTHON_DIR="${CMAKE_CURRENT_SOURCE_DIR}/../python")

# DE442's Earth and Moon as Chebyshev series for the app
# (docs/physics/ephemerides-and-gm.md).
add_executable(de_cheb de_cheb.c)
target_include_directories(de_cheb PRIVATE "${CSPICE_ROOT}/include")
target_link_libraries(de_cheb PRIVATE "${CSPICE_ROOT}/lib/cspice.a" m)
target_compile_options(de_cheb PRIVATE -O2 -Wall -Wextra)
target_compile_definitions(de_cheb PRIVATE
  ORRERY_PYTHON_DIR="${CMAKE_CURRENT_SOURCE_DIR}/../python")

# JPL's satellite ephemerides as Chebyshev series for the app's moons
# (docs/frontend/moons.md).
add_executable(moon_cheb moon_cheb.c)
target_include_directories(moon_cheb PRIVATE "${CSPICE_ROOT}/include")
target_link_libraries(moon_cheb PRIVATE "${CSPICE_ROOT}/lib/cspice.a" m)
target_compile_options(moon_cheb PRIVATE -O2 -Wall -Wextra)
target_compile_definitions(moon_cheb PRIVATE
  ORRERY_PYTHON_DIR="${CMAKE_CURRENT_SOURCE_DIR}/../python")

# The Earth's orientation for the app (docs/physics/orientation.md):
# NAIF's ITRF93 sampled for src/physics/eop.build.mjs.
add_executable(earth_orientation earth_orientation.c)
target_include_directories(earth_orientation PRIVATE "${CSPICE_ROOT}/include")
target_link_libraries(earth_orientation PRIVATE "${CSPICE_ROOT}/lib/cspice.a" m)
target_compile_options(earth_orientation PRIVATE -O2 -Wall -Wextra)
target_compile_definitions(earth_orientation PRIVATE
  ORRERY_PYTHON_DIR="${CMAKE_CURRENT_SOURCE_DIR}/../python")

# SB441's largest asteroids as Chebyshev series for the app
# (docs/frontend/small-bodies.md).
add_executable(sb_cheb sb_cheb.c)
target_include_directories(sb_cheb PRIVATE "${CSPICE_ROOT}/include")
target_link_libraries(sb_cheb PRIVATE "${CSPICE_ROOT}/lib/cspice.a" m)
target_compile_options(sb_cheb PRIVATE -O2 -Wall -Wextra)
