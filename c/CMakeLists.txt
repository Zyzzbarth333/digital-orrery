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
