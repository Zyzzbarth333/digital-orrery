KPL/MK

\begintext

   SPICE meta-kernel for the digital-orrery Python reference.

   The NAIF kernels listed below are NOT included in this repository.
   Download them from the NAIF generic kernels archive
   (https://naif.jpl.nasa.gov/pub/naif/generic_kernels/) and place them under
   python/data/kernels/, preserving the sub-directory layout shown in
   KERNELS_TO_LOAD (lsk/, pck/, spk/, spk/jupiter/, etc.).

   PATH_VALUES is a relative path resolved from the working directory the
   script is launched from. Run the Python reference scripts from the python/
   directory so that './kernels' points at python/data/kernels/ via the
   metakernel located at python/data/metakernel.tm.

\begindata

   PATH_SYMBOLS    = ( 'KERNELS' )
   PATH_VALUES     = ( './kernels' )

   KERNELS_TO_LOAD = (
       '$KERNELS/lsk/naif0012.tls'
       '$KERNELS/pck/pck00011.tpc'
       '$KERNELS/pck/gm_de440.tpc'
       '$KERNELS/pck/earth_620120_240827.bpc'
       '$KERNELS/pck/mars_iau2000_v1.tpc'
       '$KERNELS/pck/moon_pa_de440_200625.bpc'
       '$KERNELS/spk/de440.bsp'
       '$KERNELS/spk/ceres_1900_2100.bsp'
       '$KERNELS/spk/codes_300ast_20100725.bsp'
       '$KERNELS/spk/jupiter/jup344.bsp'
       '$KERNELS/spk/jupiter/jup344-s2003_j24.bsp'
       '$KERNELS/spk/jupiter/jup346.bsp'
       '$KERNELS/spk/jupiter/jup365.bsp'
       '$KERNELS/spk/mars/mar097.bsp'
       '$KERNELS/spk/neptune/nep095.bsp'
       '$KERNELS/spk/neptune/nep097.bsp'
       '$KERNELS/spk/neptune/nep097xl-801.bsp'
       '$KERNELS/spk/neptune/nep097xl-899.bsp'
       '$KERNELS/spk/neptune/nep101xl.bsp'
       '$KERNELS/spk/neptune/nep101xl-802.bsp'
       '$KERNELS/spk/neptune/nep104.bsp'
       '$KERNELS/spk/neptune/nep105.bsp'
       '$KERNELS/spk/pluto/plu060.bsp'
       '$KERNELS/spk/saturn/sat393_daphnis.bsp'
       '$KERNELS/spk/saturn/sat415.bsp'
       '$KERNELS/spk/saturn/sat441.bsp'
       '$KERNELS/spk/saturn/sat454.bsp'
       '$KERNELS/spk/uranus/ura111.bsp'
       '$KERNELS/spk/uranus/ura111l.bsp'
       '$KERNELS/spk/uranus/ura111xl-701.bsp'
       '$KERNELS/spk/uranus/ura111xl-702.bsp'
       '$KERNELS/spk/uranus/ura111xl-703.bsp'
       '$KERNELS/spk/uranus/ura111xl-704.bsp'
       '$KERNELS/spk/uranus/ura111xl-705.bsp'
       '$KERNELS/spk/uranus/ura111xl-799.bsp'
       '$KERNELS/spk/uranus/ura115.bsp'
       '$KERNELS/spk/uranus/ura116.bsp'
       '$KERNELS/spk/uranus/ura117.bsp'
       '$KERNELS/spk/comets/ison.bsp'
       '$KERNELS/spk/comets/siding_spring_8-19-14.bsp'
       '$KERNELS/spk/comets/siding_spring_s46.bsp'
   )

\begintext
