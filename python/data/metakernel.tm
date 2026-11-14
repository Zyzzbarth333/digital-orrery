KPL/MK

\begintext

   SPICE meta-kernel for the digital-orrery Python reference.

   The NAIF kernels listed below are NOT included in this repository.
   Download them from the NAIF generic kernels archive
   (https://naif.jpl.nasa.gov/pub/naif/generic_kernels/) and place them under
   python/data/kernels/ using the layout in KERNELS_TO_LOAD:

      lsk/naif0012.tls                  <- generic_kernels/lsk/
      pck/pck00011_n0066.tpc            <- generic_kernels/pck/ (IAU orientation,
                                           N0066+ toolkit format)
      pck/earth_latest_high_prec.bpc    <- generic_kernels/pck/ (precise Earth
                                           orientation; NAIF updates it often)
      pck/moon_pa_de440_200625.bpc      <- generic_kernels/pck/ (lunar libration)
      fk/moon_de440_250416.tf           <- generic_kernels/fk/satellites/
      pck/mars_konopliv_2026_n0066_v1.tpc <- generic_kernels/pck/ (Mars rotation)
      spk/de442.bsp                     <- generic_kernels/spk/planets/

      spk/satellites/mar099s.bsp        <- generic_kernels/spk/satellites/ (Mars,
                                           Phobos, Deimos)
      spk/satellites/jup365.bsp         <- (Jupiter, Galilean and inner moons)
      spk/satellites/sat441.bsp         <- (Saturn, Titan and the major moons)
      spk/satellites/ura184_part-3.bsp  <- (Uranus and its major moons)
      spk/satellites/nep097.bsp         <- (Neptune, Triton)
      spk/satellites/plu060.bsp         <- (Pluto, Charon and the small moons)
      spk/asteroids/sb441-n16.bsp       <- ssd.jpl.nasa.gov/ftp/eph/small_bodies/
                                           asteroids_de441/ (the 16 most massive
                                           asteroids, JPL's small-body perturbers)

   Load order matters: SPICE uses the last-loaded kernel that covers a body,
   and each satellite kernel also carries its own (older) copy of the
   system barycentres. DE442 is loaded last so it stays the authority for
   the barycentres and the Sun; the satellite kernels supply each planet
   and moon relative to its system barycentre.

   gm_de442.tpc is in this repo (python/data/): DE442's GM values, taken
   from NAIF's de442_tech-comments.txt because NAIF ships no gm_de442.tpc.

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

   PATH_SYMBOLS    = ( 'KERNELS', 'DATA' )
   PATH_VALUES     = ( './data/kernels', './data' )

   KERNELS_TO_LOAD = (
       '$KERNELS/lsk/naif0012.tls'
       '$KERNELS/pck/pck00011_n0066.tpc'
       '$DATA/gm_de442.tpc'
       '$KERNELS/pck/earth_latest_high_prec.bpc'
       '$KERNELS/pck/moon_pa_de440_200625.bpc'
       '$KERNELS/fk/moon_de440_250416.tf'
       '$KERNELS/pck/mars_konopliv_2026_n0066_v1.tpc'
       '$KERNELS/spk/satellites/mar099s.bsp'
       '$KERNELS/spk/satellites/jup365.bsp'
       '$KERNELS/spk/satellites/sat441.bsp'
       '$KERNELS/spk/satellites/ura184_part-3.bsp'
       '$KERNELS/spk/satellites/nep097.bsp'
       '$KERNELS/spk/satellites/plu060.bsp'
       '$KERNELS/spk/asteroids/sb441-n16.bsp'
       '$KERNELS/spk/de442.bsp'
   )

\begintext
