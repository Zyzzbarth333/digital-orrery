// tools/openrocket/ORRun.java
//
// Flies an OpenRocket design headless and writes what the orrery's ROCKET
// tab needs to fly the same vehicle and compare (src/physics/rocket.openrocket.mjs, then rocket.xcheck.test.mjs):
// each motor's thrust curve, masses and ignition, each stage's separation,
// the flight's events, and its history to apogee (thrust, mass, drag
// coefficient, reference area and more against time) and summary.
//
// OpenRocket (GPL-3.0) is used as an outside oracle only: this program runs
// against a local OpenRocket jar and nothing of OpenRocket is copied into
// the repo; only the numbers it computes for these inputs are kept.
//
//   javac -cp OpenRocket-24.12.jar -d out tools/openrocket/ORRun.java
//   java -Djava.awt.headless=true -cp OpenRocket-24.12.jar:out ORRun <design.ork> <sim index> <out.json> [seed] [time step, s]
//
// Conditions are set calm and simple so the simulators see the same flight:
// no wind, a vertical rail, launch at sea level on the equator (gravity
// 9.780 m/s^2, as RocketPy's default model gives there), the ISA atmosphere.

import com.google.inject.Guice;
import info.openrocket.core.document.OpenRocketDocument;
import info.openrocket.core.document.Simulation;
import info.openrocket.core.file.GeneralRocketLoader;
import info.openrocket.core.motor.MotorConfiguration;
import info.openrocket.core.motor.ThrustCurveMotor;
import info.openrocket.core.plugin.PluginModule;
import info.openrocket.core.rocketcomponent.AxialStage;
import info.openrocket.core.rocketcomponent.FlightConfiguration;
import info.openrocket.core.rocketcomponent.RocketComponent;
import info.openrocket.core.rocketcomponent.StageSeparationConfiguration;
import info.openrocket.core.simulation.FlightEvent;
import info.openrocket.core.simulation.FlightData;
import info.openrocket.core.simulation.FlightDataBranch;
import info.openrocket.core.simulation.FlightDataType;
import info.openrocket.core.simulation.SimulationOptions;
import info.openrocket.core.startup.Application;
import info.openrocket.swing.startup.GuiModule;

import java.io.File;
import java.io.PrintWriter;
import java.util.List;
import java.util.Locale;

public class ORRun {
  public static void main(String[] args) throws Exception {
    System.setProperty("java.awt.headless", "true");
    // The injector before any document loads: component presets and the
    // motor database hang off it.
    GuiModule gm = new GuiModule();
    Application.setInjector(Guice.createInjector(gm, new PluginModule()));
    gm.startLoader();

    OpenRocketDocument doc = new GeneralRocketLoader(new File(args[0])).load();
    Simulation sim = doc.getSimulation(Integer.parseInt(args[1]));
    SimulationOptions o = sim.getOptions();
    o.setWindSpeedAverage(0);
    o.setWindSpeedDeviation(0);
    o.setWindTurbulenceIntensity(0);
    o.setLaunchRodAngle(0);
    o.setLaunchAltitude(0);
    o.setLaunchLatitude(0);
    o.setISAAtmosphere(true);
    // OpenRocket nudges the rocket with small random pitch and yaw moments
    // (its flights are not perfectly straight); a fixed seed makes the
    // flight the same each run. A short step resolves the top of the climb.
    o.setRandomSeed(Integer.parseInt(args.length > 3 ? args[3] : "1"));
    o.setTimeStep(Double.parseDouble(args.length > 4 ? args[4] : "0.005"));
    sim.simulate();
    FlightData d = sim.getSimulatedData();
    FlightDataBranch b = d.getBranch(0);

    try (PrintWriter w = new PrintWriter(args[2], "UTF-8")) {
      w.printf(Locale.ROOT, "{\"design\":\"%s\",\"simulation\":\"%s\",\"openrocket\":\"24.12\",%n", new File(args[0]).getName(), sim.getName().replace("\"", "'"));
      w.printf(Locale.ROOT, "\"summary\":{\"maxAltitude\":%.4f,\"maxVelocity\":%.4f,\"maxAcceleration\":%.4f,\"maxMach\":%.5f,\"timeToApogee\":%.4f,\"branches\":%d},%n",
          d.getMaxAltitude(), d.getMaxVelocity(), d.getMaxAcceleration(), d.getMaxMachNumber(), d.getTimeToApogee(), d.getBranchCount());
      FlightDataType[] cols = { FlightDataType.TYPE_TIME, FlightDataType.TYPE_ALTITUDE, FlightDataType.TYPE_VELOCITY_Z, FlightDataType.TYPE_VELOCITY_TOTAL,
          FlightDataType.TYPE_MACH_NUMBER, FlightDataType.TYPE_DRAG_COEFF, FlightDataType.TYPE_DRAG_FORCE, FlightDataType.TYPE_THRUST_FORCE,
          FlightDataType.TYPE_MASS, FlightDataType.TYPE_REFERENCE_AREA, FlightDataType.TYPE_AIR_DENSITY, FlightDataType.TYPE_GRAVITY };
      String[] names = { "t", "h", "vz", "v", "mach", "cd", "drag", "thrust", "mass", "refArea", "rho", "g" };
      // The motors as flown: each one's curve from its own ignition, its
      // masses, and when it lights; the stages' separations; the events.
      FlightConfiguration fc = sim.getActiveConfiguration();
      w.print("\"motors\":[");
      String sep = "\n";
      for (MotorConfiguration mc : fc.getAllMotors()) {
        if (!(mc.getMotor() instanceof ThrustCurveMotor)) continue;
        ThrustCurveMotor tm = (ThrustCurveMotor) mc.getMotor();
        w.printf(Locale.ROOT, "%s{\"designation\":\"%s\",\"mount\":\"%s\",\"stage\":%d,\"count\":%d,\"ignitionEvent\":\"%s\",\"ignitionDelay\":%.6g,\"launchMass\":%.6g,\"burnoutMass\":%.6g,\"time\":%s,\"thrust\":%s}",
            sep, tm.getDesignation(), ((RocketComponent) mc.getMount()).getName().replace("\"", "'"), ((RocketComponent) mc.getMount()).getStageNumber(), mc.getMotorCount(), mc.getIgnitionEvent().name(), mc.getIgnitionDelay(),
            tm.getLaunchMass(), tm.getBurnoutMass(), list(tm.getTimePoints()), list(tm.getThrustPoints()));
        sep = ",\n";
      }
      w.println("],");
      w.print("\"stages\":[");
      sep = "\n";
      for (AxialStage st : fc.getAllStages()) {
        StageSeparationConfiguration c = st.getSeparationConfigurations().get(fc.getFlightConfigurationID());
        w.printf(Locale.ROOT, "%s{\"stage\":%d,\"name\":\"%s\",\"separationEvent\":\"%s\",\"separationDelay\":%.6g}", sep, st.getStageNumber(), st.getName().replace("\"", "'"), c.getSeparationEvent().name(), c.getSeparationDelay());
        sep = ",\n";
      }
      w.println("],");
      w.print("\"events\":[");
      sep = "\n";
      for (int bi = 0; bi < d.getBranchCount(); bi++)
        for (FlightEvent e : d.getBranch(bi).getEvents()) {
          w.printf(Locale.ROOT, "%s{\"branch\":%d,\"type\":\"%s\",\"t\":%.6g,\"source\":\"%s\"}", sep, bi, e.getType().name(), e.getTime(), e.getSource() == null ? "" : e.getSource().getName().replace("\"", "'"));
          sep = ",\n";
        }
      w.println("],");
      w.print("\"columns\":[");
      for (int i = 0; i < names.length; i++) w.printf("%s\"%s\"", i > 0 ? "," : "", names[i]);
      w.println("],");
      w.print("\"rows\":[");
      List<Double> t = b.get(FlightDataType.TYPE_TIME);
      double apogee = d.getTimeToApogee();
      boolean first = true;
      for (int k = 0; k < t.size(); k++) {
        if (t.get(k) > apogee + 0.05) break;          // a little past the top, to find it between samples
        w.print(first ? "\n[" : ",\n[");
        first = false;
        for (int i = 0; i < cols.length; i++) {
          List<Double> c = b.get(cols[i]);
          double v = c == null || k >= c.size() || c.get(k) == null ? Double.NaN : c.get(k);
          w.print((i > 0 ? "," : "") + (Double.isNaN(v) ? "null" : String.format(Locale.ROOT, "%.6g", v)));
        }
        w.print("]");
      }
      w.println("]}");
    }
    System.exit(0);
  }

  static String list(double[] a) {
    StringBuilder b = new StringBuilder("[");
    for (int i = 0; i < a.length; i++) b.append(i > 0 ? "," : "").append(String.format(Locale.ROOT, "%.6g", a[i]));
    return b.append("]").toString();
  }
}
