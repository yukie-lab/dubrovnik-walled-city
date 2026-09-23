# Sea reflection revision — 23 September 2026

The user requested fewer white bright areas on the sea. `bc5fe08` is the saved
baseline before this revision. This is a correction to the shared reflected-sky
transport, not a water tint, saturation control, exposure change or sea-only
postprocess. The intrinsic sea source, solar glitter, foam, wave spectrum,
bottom albedo and volume extinction/scattering coefficients remain unchanged.

## Diagnosis

`sept30glareprobe` separates sky reflection, direct-light glitter and foam in
linear HDR before the observer/tone/output transforms. Its water mask uses an
unambiguous negative RGB tag in the actual main render target, so roofs, horizon
background and postprocessing halos are not counted as detailed water.

White-area comparison uses a fixed display criterion: minimum sRGB channel at
least 160/255, channel spread at most 45/255. This is a repeatable image metric,
not a universal perceptual definition of white.

At the noon parapet view, 95,722 of 191,448 water pixels meet the criterion
(49.999%). Their combined sky/glitter/foam radiance is 92.75% sky, 7.14% glitter,
0.12% foam. At morning it is 99.49% sky. Of the noon white pixels, 34.89% have a
mirror direction below the water's horizon, and 16.14% have a shading normal
facing away from the viewer.

The shared cause is treating all resolved normal-map facets as visible mirrors,
clamping below-horizon reflection directions onto the bright horizon, and
averaging an unmasked roughness lobe without its Fresnel/visibility weights.
This affects the entire detailed sea (one mesh) and its distant spherical
background continuation (one shader path), rather than a particular shoreline.

The harbour is a separate case: foam provides 96.73% of the corresponding white
region's sky/glitter/foam radiance. Its coverage is deliberately retained under
the earlier protection requirement. This revision does not claim to remove
all white pixels everywhere.

## Shared reflection model

`water-reflection.js` integrates the atmosphere over twelve deterministic GGX
visible-normal samples and applies correlated Smith masking. F0 stays 0.0204;
the roughness continues to come from the existing distance/wind expression.
Water-directed rays are masked instead of reassigned to the bright sky.
The integrated reflection weight also supplies the transmitted-energy
complement. Direct sun/moon glitter keeps its original interface Fresnel and
its original shader expression. The far ocean uses the same integration with
the open-water mean unresolved roughness, 0.42/0.98.

The visible-normal construction and masking are based on
[PBRT 4e, Roughness Using Microfacet Theory](https://www.pbr-book.org/4ed/Reflection_Models/Roughness_Using_Microfacet_Theory).
The implementation is an RGB, single-surface-scattering approximation with
twelve samples, not an exact spectral path tracer. Invalid backfacing shading
normals use the limiting tangent-plane view. Multiple bounces between wave
facets are not traced.

`sept30glaremath2` compares the actual GPU shader in a unit-radiance environment
against independent full-NDF Cook–Torrance integration (262,144 samples for
each of 40 angle/roughness pairs). All outputs are finite and bounded by one.
Maximum absolute reflected-energy error is 0.02506, mean 0.00737; the maximum
occurs at a nearly tangent view. This quantifies the twelve-sample approximation.

## Fixed-view results

| Parapet time | White area before | After |
| --- | ---: | ---: |
| Morning 07:54 | 59.136% | 0.000% |
| Noon 12:52 | 49.999% | 0.0037% |
| Golden hour 19:18 | 86.186% | 9.878% |
| After sunset 19:51 | 42.627% | 0.000% |
| Night 22:30 | 0.000% | 0.000% |

`sept30glareaccepted` includes these five times, the harbour, the actual limestone
shelf and the existing matched photo camera. The broad white stripes decrease
while point glitter remains. The shelf's white fraction stays essentially the
same (28.361% to 28.369%), because its foam is retained. The live optical controls
still expose extinction `[1, .22, .09]`, backscatter `[.00002, .00004, .00008]`,
and bottom albedo `.30`; none of these values changed in this revision.

The original colour-difference-based regression mask falsely included a narrow
background-horizon strip and broad postprocessing influence at night. The new
`water-mask.mjs` reads an exact pre-postprocess mask for future comparisons.
Old baseline hashes and photographs are never overwritten.

`sept30glarebaseline2` / `sept30glareaccepted` compare 2,206,508 actual water
pixels across four times and two views. Bottom radiance, path length, wave
normal, foam generation, foam coverage and direct glitter differ by at most
one 8-bit step; the largest mean difference is 0.0000122/255. Effective rough
sky Fresnel is the intentional revision, while its interface F0 is unchanged.

The initial integration incurred a measured cost: sea 41.2 to 30.5fps, roof
24.8 to 21.8fps under contemporaneous moving-clock checks. Drawing the far-depth
sky after opaque surfaces lets early depth rejection avoid the hidden work.
`sept30skydepth` verifies 32 views/times with bit-identical before/after PNGs;
sea recovers to 42.8fps and roof to 25.2fps. These are DPR=1 inspection figures,
not a claim that every laptop/view sustains 60fps. Draw calls remain unchanged.

The original Downloads photo is no longer present. Comparing the current
matched-pose render with its previously saved polygon measurements yields:

| Region | Δ hue (degrees) | Δ saturation (points) | Δ lightness (points) |
| --- | ---: | ---: | ---: |
| Shallow rock shelf | +86.71 | +18.53 | +15.15 |
| Mid-depth | −0.60 | −31.06 | +14.56 |
| Deep open water | +0.80 | −45.63 | +5.82 |
| Distant water | +3.28 | −49.69 | +0.31 |

`sept30glarephoto.json` explicitly identifies the cached reference report and
original SHA256. The photo itself was not resampled. Its weakly saturated shelf
has unstable hue; coverage/geometry differ there. The photograph has no horizon.
The significant saturation mismatch remains, and no colour grade was added to
hide it. These values supersede the earlier render-side numbers for this state.

Inspection page: `shots/rendercheck/sept30glareaccepted-review.html`, generated
by `node tools/sea-glare-review.mjs`. The before/after slider includes component
ablations and links to full-size captures. Photo calibration remains an offline
measurement; the photograph is never an application asset.
