# Physical atmosphere revision, September 2026

The user's latest instruction supersedes the earlier painted-air sky and the
source freeze on `sky.js` and `light.js`. It authorizes physical atmospheric
transport, solar/lunar illumination, exposure and low-light visual adaptation.
The original `september-protected.json` remains immutable. Sea absorption,
Fresnel, wave spectrum, sparkle distribution and foam geometry/coverage remain
protected, as do geography, routes, map, title, controls and diagnostics.

The reference solar position is unchanged: latitude 42.6407°, declination
+13.8°, solar noon 12.87. This is the project's mid-August scene, not a live
astronomical forecast. The moon is a full moon opposite the sun; this assumption
must remain explicit, rather than claiming a dated lunar ephemeris.

The transport implementation uses a spherical Earth, exponential molecular and
aerosol densities, a stratospheric ozone layer, Rayleigh and Cornette–Shanks Mie
phase functions, optical-depth integration and an isotropic multiple-scattering
closure. It uses RGB bands, not full spectral transport. Parameter definitions
and verification approaches follow [Bruneton's reference implementation](https://ebruneton.github.io/precomputed_atmospheric_scattering/)
and [Hillaire's author implementation](https://github.com/sebh/UnrealEngineSkyAtmosphere).
The implementation here is written for this project's WebGL pipeline.

Distances in transport are kilometres. Rendering radiance and irradiance share
one scale: one unit corresponds to 5,000 cd/m² or 5,000 lux respectively. Sunlight
above the atmosphere is 125,000 lux; full-moon illumination is 0.25 lux before
atmospheric extinction. These are representative clear-sky inputs, not measured
weather in Dubrovnik. No time-dependent additive blue floor belongs in the sky,
environment map, hemisphere light or atmospheric haze.

Validation will include optical-depth and phase normalization, actual GPU errors,
direct/indirect radiance and exposure through all twilight stages, fixed seaward
images at short sunset intervals, moon shadows, horizon continuity, the original
four-time city/stair views, title/map/controls, and actual all-pass draw calls.

## First transport integration

`sept26cycle1` captures eight times from each of two fixed viewpoints. All sixteen
images are stable, with zero raw GPU errors; 59 compiled standard/basic material
programs pass the binding audit. Sky zenith luminance falls from approximately
1,676 cd/m² at noon to 31.9 at solar elevation −2.68°, 0.0865 at −7.71° and
0.00170 at −18.70°. The last value is primarily moon-scattered light, not a night
colour or emissive floor. These numbers are model outputs, not field measurements.

The observer pass uses absolute pre-exposure luminance to mix a three-band rod
proxy and cone colour. Its cooler low-light neutral is a perceptual approximation;
it is not part of atmospheric radiance. RGB metamerism prevents an exact spectral
rod response. [Night Rendering](https://graphics.stanford.edu/~henrik/papers/night/)
discusses both physical night illumination and these limits of hue reproduction.
Bright local lamps keep their colour because they are above the mesopic range.

## Radiance storage precision, 25 September

The 5,000 cd/m² scene unit made shaded night radiance too small for the original
RGBA16F scene targets. Comparing the identical scene in Float32 and Float16 at
six wall stairs found 83,454 erased pixels out of 256,000 in the enclosed climb;
32,393 of the 54,144 pixels in its lower, central tread region were zero in
Float16 despite nonzero Float32 radiance. All six views lost precision. Raising
camera exposure afterwards cannot recover a value that was already discarded.

`radiance-storage.js` now stores scene colour in power-of-two units, chosen from
the astronomical illuminance (1 at noon, 4,096 at 22:30). This is an invertible
representation change, following the pre-exposure principle described in
[Epic's rendering documentation](https://dev.epicgames.com/documentation/unreal-engine/auto-exposure-in-unreal-engine).
No source intensity, albedo, atmospheric radiance or exposure law changes.
The underwater buffer is decoded before refraction and screen-space reflection.
The mesopic observer reads absolute luminance, while bloom thresholds and final
display exposure use the stored units. Multiplicative dirt remains a dimensionless
transmittance coefficient. PMREM uses a separate frozen scale, published together
with its finished texture so unfinished environment jobs cannot mix units.

`stair-20260925-storage-precision` compares 1,536,000 scene pixels: erased pixels
are zero in all six views, and relative luminance RMS error versus Float32 stays
below 0.040%. `storage-20260925-reference` checks 20 combinations of storage scale
and exposure through the real mesopic/AgX output stages; at scales 4,096 and 8,192,
the maximum display difference from Float32 is 1/255. Four independent Float32
PMREM references differ by at most 0.159% RMS, with no erased or nonfinite values.
The scheduled filter still exactly matches native half-float PMREM at six times.

Three daytime staircase/parapet reference images are pixel-identical to the
committed baseline. The sky cycle has 16 stable images, 77 valid material
programs and no GPU errors. This fixes numerical loss; it does not claim that
the unlit enclosed stair is yet sufficiently legible at night. The preceding
incident-light/exposure prototype washed out the daytime enclosure and was
archived without being adopted.

The four-time sea comparison initially failed the old displayed-image tolerance:
night foam/glitter diagnostics differ by up to 2/255 after precision is restored.
An independent Float32 probe (`tools/sea-precision-probe.mjs`, `--sea-precision`)
then compared water-column length, Fresnel, normals, foam components, glitter
and foam coverage before display processing. All 48 pairs / 13,283,688 water
samples are bit-identical after decoding storage units. Coefficients and the
depth-dependent transmission remain unchanged. The old image tolerance was not
relaxed or reported as passing. Six normal sea images (two views at noon, golden
hour and sunset) are pixel-identical; the two normal night images differ by at
most 3/255 because their weak radiance is now retained. The physical sources and
exposure are identical in both captures.

Normal moving-clock checks at DPR=1 measured 27.3 fps over roofs and 47.8 fps
over the sea, with maximum 173 frame draw calls and no GPU errors. These are
measurements on the current test machine, not a universal 60 fps claim.

The sea source file remains unchanged. `atmosphere-sea.js` explicitly connects
sky reflection, incident irradiance, the fallback bottom/foam illumination floors,
the dominant sun-or-moon direction, and camera-to-water atmospheric transport.
It does not change water extinction, Fresnel coefficients, wave geometry/spectrum,
GGX roughness, sparkle sampling, foam generation or coverage. Visual sea pixels
necessarily change with the newly authorized sky/light/exposure model; their old
bitwise identity is no longer a valid atmosphere acceptance criterion.

The old painted cloud billboards are absent in this clear-atmosphere integration.
Remaining work includes the finite ocean mesh's horizon junction, directional
moon-shadow evidence, night city readability, close sunset sampling, moving-clock
performance, and physically transported clouds. This is a checkpoint, not visual
acceptance of the complete revision.

## Night meter, distant ocean and shared shadows

The visible dome continues the finite sea mesh to the spherical Earth's actual
ocean intersection. That unresolved surface uses the existing water's incident
in-scattering and F0, the same reflected sky, and the same camera-to-surface air
transport. It is background geometry only; it does not relocate shores or alter
the detailed water. The lower hemisphere of city IBL remains ground reflection.

Exposure now meters the eight real local point lights as well as sun, moon and
sky irradiance. It evaluates horizontal illuminance at the viewer's floor with
the same inverse-square law and finite-range cutoff as the render lights. This
is an approximate incident-light meter, not a full image-based camera or a new
ambient source. Local point-light occlusion is not yet represented. Broad bloom
energy was reduced because physical lamp/moon radiance made the previous
artistic strength cover much of the image with glare.

The astronomical light slots stay present at zero irradiance: adding/removing a
visible directional light as its limb crossed the horizon had recompiled city
materials and stalled the moving sunset. One complete city shadow map is now
built per frame inside Three's valid render state and shared by underwater and
main colour passes. `sept26shadow1` saves 8–11 draws: roof/street pixels are exact,
and a few harbor water pixels change where the first pass now sees complete
city shadows. `sept26motion2` measures the moving clock, including atmosphere and
PMREM: roof 31.5fps / peak193 draws; sea49.4fps / peak166. No GPU errors.

`sept26night2` compares moon shadows enabled/disabled at22:00 in three views.
Direct sunlight is zero and lunar irradiance is0.177lux. Roof pixels measurably
change with shadows; the moon also illuminates the water. Night street/roof
captures have been visually inspected; weak pedestrian contact remains for the
city inspection loop. Clear weather is deliberate, so no painted clouds return.
