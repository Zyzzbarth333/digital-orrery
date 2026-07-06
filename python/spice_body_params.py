"""
SPICE Body Parameters Reference
===============================

This module provides tools for accessing and analysing orientation models and
physical parameters of celestial bodies using SPICE kernels. It handles
parameters for:
- System barycenters
- Stars (Sun)
- Planets and their satellites
- Dwarf planets
- Asteroids and comets

Basic Usage:
-----------
    import spiceypy as spice

    # Load your kernels
    spice.furnsh("path/to/metakernel.tm")

    # Get parameter (returns tuple of (dim, values))
    values = spice.bodvcd(body_id, parameter_name, max_values)

    # Or use the high-level interface
    params = test_body_parameters(body_id)
    print_body_parameters(params)

    # Clean up
    spice.kclear()

Available Parameters:
------------------

1. Physical Parameters
    RADII : numpy.ndarray[3]
        Body dimensions in kilometers:
        - Index 0: Largest equatorial radius
        - Index 1: Smaller equatorial radius
        - Index 2: Polar radius

    GM : numpy.ndarray[1]
        Gravitational parameter (G * mass) in km^3/s^2

2. Orientation Parameters
    Three Euler angles describe each body's orientation relative to ICRF/J2000:

    POLE_RA : numpy.ndarray[3]
        Right ascension (a) of north pole
        a = a0 + a1*T + a2*T^2
        - a0: Base angle (degrees)
        - a1: Century rate (degrees/century)
        - a2: Quadratic term (degrees/century^2)

    POLE_DEC : numpy.ndarray[3]
        Declination (d) of north pole
        d = d0 + d1*T + d2*T^2
        - d0: Base angle (degrees)
        - d1: Century rate (degrees/century)
        - d2: Quadratic term (degrees/century^2)

    PM : numpy.ndarray[3]
        Prime meridian location (W)
        W = W0 + W1*d + W2*d^2
        - W0: Base angle (degrees)
        - W1: Daily rate (degrees/day)
        - W2: Quadratic term (degrees/day^2)

3. Nutation-Precession Models
    Complex rotation models include additional periodic terms:

    NUT_PREC_ANGLES : numpy.ndarray[N]
        Phase angles for periodic terms
        Different bodies use different angle sets:
        - Planets: Full set (e.g., Jupiter uses J1-J10, Ja-Je)
        - Satellites: Subset of parent's angles

    NUT_PREC_RA/DEC/PM : numpy.ndarray[N]
        Coefficients for periodic terms
        - RA uses sine terms
        - DEC uses cosine terms
        - PM typically uses sine terms

Time Systems:
-----------
All time variables are in Barycentric Dynamical Time (TDB):
- T: Centuries past J2000
- d: Days past J2000
where J2000 is Julian ephemeris date 2451545.0 (2000 Jan 1 12:00:00 TDB)

Note:
----
This implementation follows the IAU/IAG Working Group on Cartographic
Coordinates and Rotational Elements conventions. For mission-specific
applications, additional or alternate orientation models may be preferred.
"""

import spiceypy as spice
import numpy as np
from typing import Dict, Any, List, Tuple, Optional
from collections import defaultdict

def get_body_category(body_id: int) -> Tuple[str, Optional[int], Optional[str]]:
    """
    Determine body category, parent body ID, and name.

    Returns:
        Tuple of (category, parent_id, body_name)
        where:
        - category is one of: "star", "barycenter", "planet", "satellite",
                            "asteroid", "comet", "dwarf_planet"
        - parent_id is None for non-satellite bodies
        - body_name is the NAIF name if available, else None
    """
    try:
        name = spice.bodc2n(body_id)
    except Exception:
        name = None

    if body_id == 10:
        return "star", None, name
    elif 0 <= body_id < 100:
        return "barycenter", None, name
    elif 1000000 <= body_id < 2000000:
        return "comet", None, name
    elif 2000000 <= body_id < 3000000:
        return "asteroid", None, name
    elif body_id % 100 == 99:  # Main bodies (399=Earth, 499=Mars, etc)
        return "planet", body_id // 100, name
    else:  # Satellites (301=Moon, 501=Io, etc)
        parent_id = (body_id // 100) * 100 + 99
        return "satellite", parent_id, name

def format_nutation_angles(values: Optional[np.ndarray],
                         category: str,
                         parent_id: Optional[int]) -> List[Tuple[str, float, float]]:
    """
    Format nutation-precession angle pairs into (label, base, rate) tuples.

    Parameters:
    -----------
    values : ndarray or None
        Array of angle coefficients
    category : str
        Body category (e.g., "satellite", "planet")
    parent_id : int or None
        ID of parent body for satellites

    Returns:
    --------
    List of tuples (label, base_angle, rate)
    """
    if values is None or len(values) % 2 != 0:
        return []

    # Handle different body types
    if category == "satellite":
        if parent_id == 599:  # Jupiter satellite
            # Use relevant subset of Jupiter's angles
            labels = [f"J{i}" for i in range(3, len(values)//2 + 3)]
        elif parent_id == 699:  # Saturn satellite
            # Use S1-S8 for Saturn system
            labels = [f"S{i}" for i in range(1, len(values)//2 + 1)]
        else:
            # Generic labeling for other satellites
            labels = [f"N{i}" for i in range(1, len(values)//2 + 1)]
    else:
        # Full set for planets
        labels = ["J1", "J2", "J3", "J4", "J5", "J6", "J7", "J8",
                 "J9", "J10", "Ja", "Jb", "Jc", "Jd", "Je"]

    pairs = []
    for i in range(0, len(values), 2):
        if i // 2 < len(labels):
            base = values[i]
            rate = values[i + 1]
            # Skip if effectively zero
            if abs(base) < 1e-20 and abs(rate) < 1e-20:
                break
            label = labels[i // 2]
            pairs.append((label, base, rate))

    return pairs

def format_trigonometric_terms(coeff: np.ndarray,
                             angles: List[Tuple[str, float, float]],
                             trig_func: str) -> str:
    """Format trigonometric terms with their coefficients."""
    terms = []
    for i, (angle_label, _, _) in enumerate(angles):
        if i < len(coeff) and abs(coeff[i]) > 1e-20:
            sign = '+' if coeff[i] > 0 else '-'
            terms.append(f"{sign} {abs(coeff[i]):.6f}{trig_func}({angle_label})")
    return " ".join(terms) if terms else "0"

def test_body_parameters(body_id: int) -> Dict[str, Any]:
    """
    Get all available parameters for a given body.

    Parameters
    ----------
    body_id : int
        NAIF ID code for the celestial body

    Returns
    -------
    Dict[str, Any]
        Dictionary containing parameter values and metadata
    """
    category, parent_id, name = get_body_category(body_id)

    params = {
        'body_id': body_id,
        'category': category,
        'parent_id': parent_id,
        'name': name or f"Body {body_id}"
    }

    # Physical parameters
    for param in ["RADII", "GM"]:
        try:
            values = spice.bodvcd(body_id, param, 3 if param == "RADII" else 1)
            params[param] = values[1]
        except Exception:
            params[param] = None

    # Orientation parameters
    for param in ["POLE_RA", "POLE_DEC", "PM"]:
        try:
            values = spice.bodvcd(body_id, param, 3)
            params[param] = values[1]
        except Exception:
            params[param] = None

    # Nutation-precession terms
    # Smaller number of terms for asteroids/comets
    max_terms = 16 if category in ["asteroid", "comet"] else 100

    try:
        values = spice.bodvcd(body_id, "NUT_PREC_ANGLES", max_terms)
        params["NUT_PREC_ANGLES"] = values[1]
    except Exception:
        params["NUT_PREC_ANGLES"] = None

    for param in ["NUT_PREC_RA", "NUT_PREC_DEC", "NUT_PREC_PM"]:
        try:
            values = spice.bodvcd(body_id, param, max_terms)
            # Find last non-zero value
            non_zero_indices = np.where(np.abs(values[1]) > 1e-20)[0]
            if len(non_zero_indices) > 0:
                last_non_zero = non_zero_indices[-1]
                params[param] = values[1][:last_non_zero + 1]
            else:
                params[param] = None
        except Exception:
            params[param] = None

    # Check for epoch data (used by some comets)
    try:
        epoch = spice.bodvcd(body_id, "CONSTANTS_JED_EPOCH", 1)
        params["EPOCH"] = epoch[1][0]
    except Exception:
        params["EPOCH"] = None

    return params

def format_scientific_notation(value: float, precision: int = 6, force_scientific: bool = False) -> str:
    """
    Format numbers using appropriate notation based on magnitude and type.

    Parameters
    ----------
    value : float
        Value to format
    precision : int
        Number of decimal places to show
    force_scientific : bool
        If True, always use scientific notation
    """
    abs_value = abs(value)
    if abs_value == 0:
        return "0.000000"
    elif force_scientific or abs_value >= 1e6 or abs_value < 1e-4:
        return f"{value:.{precision}e}"
    else:
        return f"{value:.{precision}f}"

def format_parameter_value(name: str, value: float, label_width: int = 25) -> str:
    """
    Format parameter values with consistent spacing and notation.

    Parameters
    ----------
    name : str
        Parameter name for context
    value : float
        Value to format
    label_width : int
        Width for label alignment
    """
    if "GM" in name:
        value_str = format_scientific_notation(value, 6, force_scientific=True)
    elif "RADII" in name:
        value_str = format_scientific_notation(value, 3, force_scientific=False)
    else:  # Angles and other parameters
        value_str = format_scientific_notation(value, 6, force_scientific=False)
    return value_str.rjust(15)  # Consistent width for all values

def print_body_parameters(params: Dict[str, Any]) -> None:
    """Print formatted parameters for a body."""
    # Consistent header width
    LINE_WIDTH = 75
    print(f"\n{'=' * LINE_WIDTH}")

    header = f"Parameters for {params['name']} (ID: {params['body_id']}"
    if params['category'] == "satellite" and params['parent_id'] is not None:
        try:
            parent_name = spice.bodc2n(params['parent_id'])
            header += f", {parent_name} satellite"
        except Exception:
            header += f", Satellite of Body {params['parent_id']}"
    elif params['category'] in ["asteroid", "comet"]:
        header += f", {params['category'].capitalize()}"
    header += ")"

    print(header)
    print(f"{'=' * LINE_WIDTH}")

    # Physical parameters section
    if any(params.get(param) is not None for param in ['RADII', 'GM']):
        print("\nPhysical Parameters:")
        print('-' * 20)

        if params.get('RADII') is not None:
            print("\nRadii (kilometers):")
            for i, label in enumerate([
                "Equatorial (a):", "Equatorial (b):", "Polar (c):     "
            ]):
                print(f"  {label:<15}{format_parameter_value('RADII', params['RADII'][i])}")

        if params.get('GM') is not None:
            print("\nGravitational Parameter:")
            print(f"  {'GM (km^3/s^2):':<15}{format_parameter_value('GM', params['GM'][0])}")

    # Orientation parameters section
    if any(params.get(param) is not None for param in ['POLE_RA', 'POLE_DEC', 'PM']):
        print("\nOrientation Parameters:")
        print('-' * 22)

        param_labels = {
            'POLE_RA': ('Right Ascension of Pole', ('Base value', 'Century rate', 'Quadratic term')),
            'POLE_DEC': ('Declination of Pole', ('Base value', 'Century rate', 'Quadratic term')),
            'PM': ('Prime Meridian', ('W0 (base angle)', 'W1 (daily rate)', 'W2 (quadratic term)'))
        }

        for param, (title, sublabels) in param_labels.items():
            if params.get(param) is not None:
                print(f"\n{title} (degrees):")
                for i, label in enumerate(sublabels):
                    print(f"  {label:<20}{format_parameter_value(param, params[param][i])}")

    # Nutation-precession terms
    if params.get("NUT_PREC_ANGLES") is not None:
        angles = format_nutation_angles(
            params["NUT_PREC_ANGLES"],
            params['category'],
            params['parent_id']
        )

        if angles:
            print("\nNutation-Precession Terms:")
            print('-' * 24)

            print("\nPhase Angles (degrees and degrees/century):")
            for label, base, rate in angles:
                base_str = format_parameter_value('ANGLE', base)
                rate_str = format_parameter_value('RATE', rate)
                print(f"  {label:<3} = {base_str} + {rate_str}T")

            # Format trigonometric terms
            for param, trig_func in [
                ("NUT_PREC_RA", "sin"),
                ("NUT_PREC_DEC", "cos"),
                ("NUT_PREC_PM", "sin")
            ]:
                if params.get(param) is not None:
                    terms = format_trigonometric_terms(params[param], angles, trig_func)
                    if terms != "0":
                        print(f"\n{param.replace('_', ' ')} ({trig_func} terms):")
                        print(f"  {terms}")

    # Epoch information (mainly for comets)
    if params.get("EPOCH") is not None:
        print("\nReference Epoch:")
        print("-" * 16)
        print(f"  JD TDB: {format_parameter_value('EPOCH', params['EPOCH'])}")

def organize_bodies(bodies: List[int]) -> List[int]:
    """
    Organise bodies in a logical hierarchy:
    1. Barycenters
    2. Star (Sun)
    3. Planets with their satellites
    4. Dwarf planets
    5. Asteroids
    6. Comets
    """
    categories = defaultdict(list)
    satellites = defaultdict(list)

    for body_id in bodies:
        category, parent_id, _ = get_body_category(body_id)
        if category == "satellite":
            satellites[parent_id].append(body_id)
        else:
            categories[category].append(body_id)

    # Sort within each category
    for cat in categories:
        categories[cat].sort()
    for parent_id in satellites:
        satellites[parent_id].sort()

    # Combine in desired order
    organized = []

    # Barycenters and Sun
    organized.extend(categories["barycenter"])
    organized.extend(categories["star"])

    # Planets and their satellites
    for planet_id in sorted(categories["planet"]):
        organized.append(planet_id)
        if planet_id in satellites:
            organized.extend(satellites[planet_id])

    # Other categories
    for category in ["dwarf_planet", "asteroid", "comet"]:
        organized.extend(categories[category])

    return organized

def main():
    """Exercise the SPICE parameter retrieval system across a set of bodies."""
    print("Loading SPICE kernels...")
    spice.furnsh("data/metakernel.tm")

    # Define bodies to inspect
    bodies_to_test = (
        list(range(11)) +      # System barycenters 0-10 and Sun
        [399,   # Earth
         301,   # Moon
         499,   # Mars
         401,   # Phobos
         402,   # Deimos
         599,   # Jupiter
         501,   # Io
         502,   # Europa
         503,   # Ganymede
         504,   # Callisto
         699,   # Saturn
         2000001,  # Ceres (asteroid)
         1000005]  # Borrelly (comet)
    )

    # Organise and inspect bodies
    organized_bodies = organize_bodies(bodies_to_test)
    for body_id in organized_bodies:
        params = test_body_parameters(body_id)
        print_body_parameters(params)

    spice.kclear()

if __name__ == "__main__":
    main()
