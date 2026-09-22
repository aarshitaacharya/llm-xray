/**
 * Plotly bound to the gl3d-only distribution.
 *
 * The star map is the one chart in the app and it only ever draws scatter3d
 * traces. Importing the full plotly.js bundle pulled ~4.5MB into the build for
 * chart types nothing renders, so this wires react-plotly.js to the gl3d bundle
 * instead.
 */
import Plotly from "plotly.js-gl3d-dist-min";
import createPlotlyComponent from "react-plotly.js/factory";

export default createPlotlyComponent(Plotly);
