# Zones and systems

The Studio's design flow, settled with Isaac on 2026-09-18 to 2026-09-20 in the "Zones and systems" mock (claude.ai artifact CGns7PUHtEer6Jo9h7sjY5, v20). The mock is the picture; this page is the rules the code follows and the order it was built in. It stays behind `NEXT_PUBLIC_STUDIO_BUILDER` until walked at 1440.

A **zone** is what a room was: it is drawn on the plan and belongs to the plan. A **system** claims zones before it has a unit, is built in the builder one system at a time with its zones given, has its units dragged onto the plan from a rack under its card, and then answers its install questions.

## The rules


### Zones

- **One house all the way through,** bar step 7's big living area. Seven zones. System 1 is the Living area on a split. System 2 is the five rooms beside it on a multi, 11.7 kW of load. The Laundry is left without a system: not every zone is conditioned, so it stays orange in the list and nothing warns about it.
- **System colours skip orange and vermilion.** Blue, teal, violet, pink, green, indigo. Orange is only ever a zone nobody has claimed.
- **Add a system starts claim mode.** Every zone is clickable, claimed or not: a click adds it, a second click takes it off, and Done or Escape ends it. A system with no zones is allowed; its card says No zones.
- **A zone on two systems** wears the first system's colour with both dots in its corner.
- **Add zones on the card, Add zone in the builder.** Both claim zones the plan already has: the card's puts the plan in claim mode, the builder's is a list. Neither draws a zone; that is the Zone tool, on the plan.

### The builder

- **The trail is the family of outdoor, then the head type.** Split, Multi, VRF, then the pack's head types, with no counts. It starts from the zones claimed, one zone Split and more Multi, and never locks: heads on two zones under Split turn the outdoor list to multis.
- **The header's Type is what the units say.** One head on one zone is a split, heads on more than one a multi, a unit on the band ducted, a VRF outdoor VRF. Before the first unit the rail shows Zones and Load only.
- **The band above the zones** takes a unit that serves the whole system; a unit dropped on a zone serves that zone.
- **Brand is a filter, not a fork.** The menu has a search and the ticked brands first, scrolls past eight, and opens on the brands ticked last time. The first unit in locks the system to its brand until the system is empty again.
- **Compare is universal.** Tick units on either tab; one tick is that unit's spec sheet. Add is a separate press, and across a locked brand it reads Locked to that brand.
- **It works from either end.** Set the outdoor first and the head list shows only what it takes; add heads first and every outdoor of the family shows Valid or Fails.
- **The outdoor box** is dashed with the word Outdoor until something lands, then the proposal, then your pick. The proposal follows the heads and goes with the last one; an outdoor you picked stays until you change it, and Use the proposal, on the Outdoor tab, hands the choice back.
- **Zone cards.** Heads are dragged onto them, and a second head adds, it never replaces; changing a size is the head's own Swap. Rows are balanced, at most four across: five zones sit three and two. Add zone is the last card, and each zone card takes the same cross as the panel's chips.
- **A short zone goes red and asks for more.** A slot opens under its heads. On a split it reads Add another split, and a head dropped there comes with its own outdoor, as a second system over the same zone. On a multi it reads Add another unit, and the head joins the same outdoor. The slot closes once the zone is covered, and the header's Cover is red while any zone is short.
- **A shared zone shows the other system's units** in its colour and read-only, so the zone's verdict is the whole zone's. The header's Load is this system's share: 7.0 of 14.0 kW.
- **Done is off while anything can't be installed:** a combination that fails, a unit of another brand, a head its outdoor can't take. The reason sits beside it in red. A short zone is red too but doesn't stop Done: capacity is a judgement, compatibility isn't.
- **The builder edits a draft.** Done applies it as one undo step; Discard changes drops it. Delete system sits at the left of the footer and takes effect at once: its zones go back to orange and its units come off the plan, one undo step.

### The panel and the plan

- **One card is open at a time.** Clicking a card at rest opens it and rests the other; clicking the open card's name rests it. Picking a zone or a unit on the plan opens its card, and so does Done in the builder.
- **A card at rest is its name, type and brand, and one line** saying where it's up to: No units yet, 6 units, 2 to place, Install questions next, or Ready for the design sheet. A failing combination or a short zone takes the line, in red. Its zones show when it's open; the plan's colours show them the rest of the time.
- **The open card's last slot is the next step:** Build system, then the units to place, then **Next: Install questions** — the words the toolbar's next-step chip says, so the two agree. Under it, across the card and quiet, Edit system: the way back into a system that's already right, never the move being asked for. Add zones ends the zone chips.
- **What the system is sits at the right of the name line:** the type word with the brand under it, the two starting on one left edge, each on a dot, so a long name has the rest of the row.
- **Units to place are a rack,** like tiles on a Scrabble rack. A unit dragged onto the plan leaves it and the rest close up; when the last is down the rack is gone. A unit taken off the plan goes back in. No Place, no Place all; each unit has a grip on its left edge. While a head is dragged its own zone is outlined; dropped outside it, it still serves its zone.
- **Zones move in the panel.** The cross on a chip takes the zone off its system, and its units with it. Drag a chip from the open card onto another card and the zone moves with its units, and anything that belongs to them; what belongs to a system, the outdoor's isolator, bracket and charge, stays and is worked out again for both. Drag a zone onto Zones without a system, the same as the cross; from that list onto a card, the same as clicking it in Add zones. Each is one undo step.
- **A move that doesn't fit opens the builder.** When a moved unit can't join its new system, another brand or an outdoor that can't take it, that system's builder opens with the unit flagged, and Done stays off until it's fixed. Discard changes undoes the move. A move that fits lands at once.
- **The pipework comes too.** A moved head keeps its drawn run, loose at the old outdoor's end: dashed in the new system's colour and counted by neither. Dragging the loose end onto the new outdoor connects it and measures it again.
- **Zone chips are controls now,** so they take the control's form: a hairline and the 6px radius, not a filled pill. The cross is the chip's clear cross, the one icon-only button the laws allow on a chip, and it shows on keyboard focus as well as hover.
- **Rename by clicking the name,** on the card or in the builder's header. Nothing hides behind three dots.
- **The plan's zone labels do not change.** A placed unit is drawn as a unit in its zone, with its model beside it.

### Install

- **The install questions come after the units are on the plan,** one system at a time, from its card. Placing tells them where each unit is.
- **They ask only what the plan and the pack can't answer.** The plan answers where the outdoor sits. The pack sizes the isolator, gives the outdoor's running amps and adds the joint pipes a port needs.
- **They start at the outdoor.** There was a survey of the building first and it earned one line, so nothing asks what the building *is* — a shop and a warehouse go in the way a house does — and the walls question now sits with the heads as *What do the heads fix to?*, still answered once and kept for every system. The three groups are Outdoor, Indoor units, Electrical.
- **The outdoor's group says what you're standing up:** its model, what it measures and what it weighs, all from the pack, so the bracket and the base are picked against the real thing.
- **Every question takes Not sure yet.** It stands alone — picking it clears the rest, picking anything else clears it — and it is an answer, not a gap: it counts as answered, never holds a system back, and leaves the line it decides on the list marked Confirm on the day.
- **One question covers the electrical:** *Are we doing the electrical work?* Yes puts the isolator the pack sizes on the list and, beside it, the current the supply cable has to carry — the outdoor's max running amps. The **size** of that cable is the wiring rules' answer and the electrician's to sign for; the Studio never invents one.
- **Every answer puts its parts on the equipment list as you go:** the pack's own accessories where it has them (drain socket, air outlet guide, Wi-Fi adapter, wired controller and its interface, joint pipes), the Studio's catalogue for the rest (brackets, feet, pads, frames, fixings, isolator, a third-party pump).
- **Every question takes more than one answer.** Where only one can happen in the end, like where the outdoor sits, two answers mean make provisions for both: both lots of parts go on the list marked Confirm on the day, and the job card carries the note for the installer. Where both can happen, like a wired controller and Wi-Fi, both are fitted.
- **An answer can ask a follow-up:** a wall asks which bracket, the ground asks what it stands on, and each follow-up takes more than one answer too.
- **A pump is the unit's own where the pack says it's built in,** as on the PEAD; otherwise a pump answer brings a third-party pump.
- **Pipework isn't asked.** The drawn runs say whether it's coil or hard drawn, and hard drawn brings its lagging.
- **Nothing waits on an answer.** An open question shows on the list as waiting, and the card at rest says Install questions next. The equipment list is the one the design sheet and the job card read.

### Figures

- **Cover is the one figure:** each zone's head rating, capped at the outdoor, summed. 14.2 kW of heads on a 10.0 kW outdoor reads 14.2, because diversity is normal; a zone only fails when its own heads outrun the outdoor. The header, the summary, the card and the design sheet all read it.
- **Every combination says Valid or Fails,** on the outdoor list, the outdoor box, the header and the card, whatever the brand's rule. Ports are information, never the verdict.
- **A multi shows its connection ratio,** the heads added up against the outdoor, on every brand. Where the brand's rule is the ratio it carries the verdict; on Mitsubishi the table decides and the ratio is just the figure. A split has nothing to add up.
- **The summary** is a line per zone, then the outdoor with its supply, then the pipework, all from the pack. The isolator is sized from the pack and confirmed in the install questions.

## The build

What is there already, and the order the rest goes in. It stays behind the Studio's builder flag until it has been walked at 1440.


### Already there

- **From #742, flagged and not merged:** units held as allocations on their system, placed or not; the builder engine in builder.ts, with the outdoor proposal that follows the heads until one is picked by hand, swap in place, and placing in a unit's own room; systemCover, the one figure the panel and the design sheet read; the unit browser with search, series groups and compare; and the builder sheet with its draft and schematic, whose Continue becomes Done.
- **From #757, merged:** the isolator sized to the outdoor's draw, on its own supply. The install questions show it as answered.
- **Written, not committed:** zones.ts, where a system claims zones and its type is read from its units, with five tests. Two of them wait on addSplit taking an existing system.

### In order

- **The engine, tests first, on the real pack.** addSplit into a given system. A zone moving with its units, their parts and their runs, loose at the old outdoor. The findings that keep Done off. Add another split making a second system over the zone. Use the proposal, and a proposal going with the last head. The jobs are this page's: the five-zone multi at 14.2 kW, the 14 kW living area on two splits, and Guest onto System 1.
- **Zones on the plan.** Rooms read as zones on screen. A zone takes its system's colour, orange while nobody has it, both dots when it is shared. Claim mode with its bar, Done and Escape. The system colours lose their two oranges.
- **The panel.** System cards at rest and open, units to place under their card with the grip, zone chips with the cross and the drag, and Zones without a system. The toolbar's tray goes.
- **The builder.** The header rail, the trail and the Indoor and Outdoor switch, the brands menu, zone cards in balanced rows with Add zone, the outdoor box, the short-zone slot, the band, Done off with its reason, and Delete system.
- **Install questions.** The cockpit's Components tab becomes the questions: its choices, mounting, isolator and lagging, become answers, what the heads fix to is kept on the design, and the pack's accessories come in where the pack has them. The catalogue's fixings wait on your list of what you stock for each wall, and the supply cable's **size** waits on a cable table — the Studio has the amps and will not guess the rest.
- **Walk it** in the test house at 1440, then the flag comes off. The code's own names move from room to zone after that, in a change of their own.
