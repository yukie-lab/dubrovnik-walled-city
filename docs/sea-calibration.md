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
