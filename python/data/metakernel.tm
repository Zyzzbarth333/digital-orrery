KPL/MK

\begintext

   SPICE meta-kernel for the digital-orrery Python reference.

   The NAIF kernels listed below are NOT included in this repository.
   Download them from the NAIF generic kernels archive
   (https://naif.jpl.nasa.gov/pub/naif/generic_kernels/) and place them under
   python/data/kernels/ using the layout in KERNELS_TO_LOAD:

      lsk/naif0012.tls    <- generic_kernels/lsk/naif0012.tls
      pck/pck00011.tpc    <- generic_kernels/pck/pck00011.tpc
      pck/gm_de440.tpc    <- generic_kernels/pck/gm_de440.tpc
      spk/de440.bsp       <- generic_kernels/spk/planets/de440.bsp

   SPICE resolves PATH_VALUES relative to the process working directory, not
   to this file. Run the Python reference scripts from the python/ directory
   (they load 'data/metakernel.tm'), so './data/kernels' is
   python/data/kernels/.

   This set covers the Sun, planets, Moon and planetary barycentres (DE440)
   plus body radii, orientation and GM values. Satellite, asteroid and comet
   ephemerides need extra SPKs (e.g. spk/satellites/jup365.bsp, ~1.1 GB);
   download them and add their paths to KERNELS_TO_LOAD only when needed.
   SPICE stops at the first listed kernel that is missing.

\begindata

   PATH_SYMBOLS    = ( 'KERNELS' )
   PATH_VALUES     = ( './data/kernels' )

   KERNELS_TO_LOAD = (
       '$KERNELS/lsk/naif0012.tls'
       '$KERNELS/pck/pck00011.tpc'
       '$KERNELS/pck/gm_de440.tpc'
       '$KERNELS/spk/de440.bsp'
   )

\begintext
