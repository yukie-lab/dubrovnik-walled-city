# Adriatic water calibration — in progress

Baseline: `56c7019`. The supplied `vogue_travel10.jpg` is an offline calibration
reference, never an application asset. Its SHA-256 is
`af214910e1b378f15dfb705ce00c2f2dbe2f9e9978cbcbbcc4a414984ccbea21`.
The JPEG contains no EXIF or embedded colour profile; measurements assume sRGB.

The view is inferred to look southwest from high ground east/northeast of the
old harbour. The first angle estimate was 35–50° below horizontal. Matching the
fort/cathedral projection indicates telephoto compression; the fixed model
camera is `(370,330,-395)`, looking at `(158,30,29)`, vertical FOV9°. Sampled water
rays are approximately28–36° below horizontal. This is a best comparable view,
not a recovered camera solution: the existing model's harbour/fort dimensions
do not allow an exact photograph registration, and geographic records are fixed.

Sun elevation45–65°, southeast-to-south illumination and late morning/near noon
are plausible from the hard shadows. Exact time/date cannot be recovered. The
model uses11.8h, sun elevation58.008°, azimuth149.550° and clear sky. The photograph
has no sky or horizon, so cloud cover outside the image is unknown. Strong direct
sun is evident; a clear-sky model is the documented working condition.

Rock immediately below the fortress supplies the shallow-water reference. A
boat-free harbour patch, left open water and upper-frame distant water supply
the other samples. These are depth classes, not depth measurements. A
[published harbour survey](https://www.teledynemarine.com/en-us/news/Documents/TM%20case%20study%20Dubrovnik%20Old%20Town.pdf)
reports0–15m in the survey area and some areas shallower than1.5m; it does not
identify the depth of every pixel in this photograph. Fort/harbour identification
is consistent with the [Dubrovnik Tourist Board's harbour description](https://tzdubrovnik.hr/lang/en/get/spomenici/5482/the_city_harbour.html).

No true horizon appears. `distant` is explicitly a distant open-water sample,
not a substituted horizon measurement. The horizon will be inspected separately
through the day cycle without claiming a photograph-derived error there.

Warm limestone and strong orange/blue contrast suggest camera white balance,
saturation/contrast processing and possibly a polarizer. These cannot be
identified uniquely. Around33% of deep/distant sample pixels have R=0, so the
JPEG contains a significant clipped red-channel floor. The physical model must
not reproduce that clipping with a water-only colour transform.

All photo/render polygons are fixed in `sea-calibration.json` before fitting.
Average linear-sRGB radiance proxies are encoded to sRGB, then converted to HSL.
No rejection based on pixel colour is used. `sea-colour-report.py` provides the
final polygon-inclusive report and side-by-side crops; the optimizer's
pixel-centre polygon rasterization can differ slightly along the boundary.

Initial H/S/L differences (render minus photograph), degrees/percentage points:

| Region | Photo H/S/L | Initial difference H/S/L |
|---|---|---|
| Shelf |117.68 /7.06 /24.17|+83.34 /+15.15 /+21.88|
| Mid depth |207.78 /90.81 /17.19|−1.79 /−51.06 /+28.35|
| Deep |213.13 /95.62 /21.64|−2.63 /−58.76 /+19.94|
| Distant, not horizon |211.90 /93.89 /27.13|+0.55 /−56.93 /+15.40|

The initial search keeps extinction `[1,.16,.03] m⁻¹`, all depths, the bottom,
Fresnel, waves and foam fixed. It changes effective RGB volume backscattering
`beta [m⁻¹ sr⁻¹]`. Source radiance is `E_RGB * beta / extinction`; the existing
homogeneous Beer–Lambert integration supplies its path dependence. Incident
RGB irradiance comes from the same physical sun, moon and integrated sky.
These are three effective rendering bands, not uniquely retrieved measured
Adriatic spectra. Absorption and scattering remain distinct physical parameters;
see [NASA's IOP description](https://modis.gsfc.nasa.gov/data/dataprod/Iop.php).

`sept27photopose2` preserves the matched-camera baseline and separate water
diagnostics. `sept27seapreservebase` preserves noon, golden hour, sunset and true
night at two fixed water viewpoints. Calibration and regression are not yet
complete; the continuous sunset recording and city inspection loop remain active.

## September 22 inspection checkpoint

The current candidate is `extinction = [1, .22, .09] m⁻¹` and effective volume
backscattering `beta = [.00002, .00004, .00008] m⁻¹ sr⁻¹`. Nominal bottom albedo
remains `.30` (scale1 on the existing varied bottom materials). Bathymetry,
Fresnel, wave spectrum, foam and glitter code in `sea.js` remain byte-identical
to `56c7019`. These are provisional rendering coefficients, not measured
spectral properties of the Adriatic, and the photograph match is **not complete**.

The old illumination adapter captured a construction-time scattering ratio,
overwriting changes on the next frame. The live transport state now evaluates
`E_RGB * beta / extinction` from the actual sun, moon and sky irradiance each
frame. The sea's far reflection also contained one fixed horizon/zenith blend,
affecting all four photo-view regions. This source-radiance approximation now
uses12 deterministic GGX importance samples of the physical sky LUT. The
Fresnel response and solar/lunar glitter lobe are unchanged.

Offline search results, weighted8-bit RGB RMSE over the same polygons:

| Search | Evaluations | Best RMSE | Decision |
|---|---:|---:|---|
| Backscatter only |60|47.61|Zero-scattering result rejected as a liquid-water solution|
| Bounded extinction + nonzero backscatter |45|38.23|Short-path transmission bounds reached|
| Same search with integrated reflected sky |45|33.84|Current optical candidate|
| Add bottom albedo |57|27.70|Albedo .08 rejected: it darkens bare submerged limestone|

The final rounds of the accepted search made no further improvement within
those bounds. The lower-error bottom fit converged to an albedo boundary, with
the last improvements only .020–.021 RGB units, but fails the visual preservation
criterion. Its images and trace are retained as rejected evidence. The live
panel still exposes bottom albedo for user adjustment, applied before the
terrain BRDF through the common near/far terrain material paths (two materials),
and to the unresolved-bottom fallback. At the default it is an identity.

Current differences (`sept27colourcandidate`, render minus photograph):

| Region | Render H/S/L | Difference H/S/L |
|---|---|---|
| Shelf |204.51 /25.57 /39.50|+86.83 /+18.51 /+15.33|
| Mid depth |207.02 /61.66 /31.34|−0.77 /−29.16 /+14.15|
| Deep |213.86 /48.73 /28.17|+0.73 /−46.88 /+6.52|
| Distant, not horizon |214.84 /42.82 /28.86|+2.94 /−51.07 /+1.73|

[Side-by-side crops](../shots/rendercheck/sept27colourcandidate-crops.png) and
[the full numerical report](../shots/rendercheck/sept27colourcandidate.json)
retain the large residuals. Low-saturation shelf hue is poorly conditioned;
its87° hue error must not be interpreted like a saturated open-water hue error.

The component probe reads half-float radiance before observer/exposure/output
processing. At the matched camera, after the sky-integration fix, deep-water
red is mostly sky reflection (.01328), glitter (.01115) and aerial perspective
(.00858), in5000cd/m² units. Even removing **all** bottom and volume radiance in
an inspection-only diagnostic leaves rendered deep mean R35.72, versus R2.42
in the JPEG. This is evidence that lowering water scattering further cannot
remove the residual; it is not a proof that every conceivable atmospheric or
camera condition has been exhausted. No water tint or selective tone transform
was added to force the JPEG's clipped channel floor.

The shelf regions also differ materially: the rendered region contains preserved
foam, which supplies about73% of its red radiance; the photograph samples darker
water immediately under the stone ledge. Actual depth, shade, polarization and
camera processing are unknown. The model's harbour geometry and high-camera
shadow coverage limit exact registration. The polygons have not been moved to
hide these mismatches, and sea-floor albedo is not reduced to compensate for them.

`sept27watercomparison` compares six protected diagnostic images at two views
and four times using3,286,046 baseline-defined water pixels. Maximum difference
is1/255; worst mean absolute difference is .000243/255. This small GPU arithmetic
variation is reported rather than claiming bit identity. Water-column length,
Fresnel, normals, foam generation/coverage and glitter all pass. All-pass maximum
is148 draws, GPU errors0. The additional `sea-clarity.json` reference looks onto
the actual0.412m-deep southern shelf; `sept27claritybase` is replayed directly
from baseline Git sources, and `sept27claritylow` records the rejected albedo.

Spectral transmittance itself necessarily changes with the authorized extinction
adjustment. For0.5m vertical depth at35° depression and58° sun elevation, the
round-trip path is1.461m: RGB transmission changes from `[.232,.792,.957]` to
`[.232,.725,.877]`. At2m it changes from `[.00289,.393,.839]` to
`[.00289,.276,.591]`. The water remains transmissive; these numbers must not be
described as unchanged transparency. The rejected albedo fit demonstrates why
preserving the appearance of the shelf takes precedence over a smaller RGB error.

The right-hand **海の光学** panel provides live numeric/log sliders for the six
transport coefficients, a bottom-albedo control, pause, reset and a copyable
parameter record. Title, old map, clock and debug remain. The supplied photograph
is only read by offline Python; neither it nor any extracted pixel data is sent
to the rendering browser. The continuous sunset and city inspection loop continue.
