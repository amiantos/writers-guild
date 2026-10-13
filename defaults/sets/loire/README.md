# The Loire

A sample set bundled with Writers Guild to show characters, a lorebook, stories, and a
continuity working together. Four caretakers ride out the long leg of an Earth-Mars cycler's
orbit in 2091: no faster-than-light travel, no thinking machines, no rescue, and a
seventeen-year-old ship that needs them.

Onboarding imports it when the user chooses "import sample content". It arrives as:

- four characters, with no embedded lorebooks of their own
- one lorebook, **The Loire**, attached to both stories
- two finished stories, _Spin Down_ (third person limited, following Priya) and _The Cellar_
- one continuity, **The Loire, long leg home**, with two versions in its history: the text as it
  stood after _Spin Down_, and the Archivist's update after _The Cellar_

## Files

```
set.json                  the manifest: which files make up the set, and in what order
characters/*.json         Character Card V2 JSON, one per character
characters/*.png          optional portrait for the card of the same name (see below)
lorebook.json             SillyTavern standalone lorebook
continuity.json           the continuity's name and its versions, oldest first
stories/*.json            story metadata: title, description, scenario, perspective, cast
stories/*.txt             the story's text, named by the metadata's `content`
```

A version in `continuity.json` with `"source": "archivist"` names the story it came from in
`story`, and is recorded as an Archivist update from that story. The last version is the
continuity's current text.

## Portraits

A card's portrait is the PNG beside its JSON with the same base name (`characters/halvorsen.png`
for `characters/halvorsen.json`); the importer uses it as the card image. Any PNG works; it does
not need a card embedded in it. The bundled portraits were generated from the descriptions below
and then palette-quantized (256 colours, dithered) to keep the repository and the Docker image
small; the originals were about three times the size.

The descriptions are written to be pasted into an image generator. They share a style so the four
read as one crew.

**Shared style.** Painterly science-fiction character portrait, head and shoulders, three-quarter
view, looking just off camera. Lit from one side by cool white panel light with a faint violet
fill from greenhouse grow-lights. Background is the curved grey interior of a spacecraft, out of
focus. Olive-green crew coverall with a small embroidered ship's patch on the chest. Realistic,
grounded, no helmets, no glowing eyes, no lens flare. Near-future, lived-in, slightly worn.

**Ingrid Halvorsen, 54, commander.** Norwegian woman, tall and rangy, with cropped grey hair,
pale blue eyes, and a face weathered by Arctic wind: deep lines at the eyes and mouth, no
makeup. Olive coverall unzipped to the waist over a black thermal shirt, sleeves pushed up,
an old burn scar across the back of her left forearm. A pencil behind one ear. Expression:
level, unimpressed, faintly amused, the look of someone who has already checked your number.

**Tomás Araya, 36, botanist.** Chilean man, medium height, stocky and strong through the
shoulders, with dark curly hair tied back and a close dark beard. Warm brown eyes and a wide,
easy smile. Olive coverall with the sleeves rolled to the elbow, green soil stains on his
fingers, a small seed packet and a sprig of basil tucked into his chest pocket. Expression:
mid-laugh, about to offer you something to eat. The violet grow-light fill is strongest on him.

**Priya Venkataraman, 29, systems engineer.** Indian woman, small and wiry, with long black hair
in a single braid over one shoulder and dark, quick, attentive eyes. A soft grey knitted
cardigan worn over the olive coverall against the cold, cuffs pulled over her hands. Holding a
thin tablet against her chest. Expression: focused, slightly anxious, on the edge of a dry
remark; chewing the inside of her cheek.

**Wekesa Odhiambo, 43, flight surgeon.** Kenyan man, tall and lean, with a shaved head, a close
grey-flecked beard, deep brown skin, and a thin scar through his left eyebrow. The blue collar of
an EVA liner garment shows under the olive coverall. Long, careful hands; one holds a small
penlight. Expression: calm, patient, listening with his whole attention, a hint of warmth around
the eyes.
