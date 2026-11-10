// #1778 research (Opus), AUTHORED: schema + defaults shared by scenes.
package scene

#Script: {inline: string} | {program: =~"^scripts/"}

#Placement: {
	id:    =~"^[a-z0-9][a-z0-9._-]*$"
	actor: string
	at: [int, int, int & >=1]
	whilePresent?: #Script
	// A default, not a constraint: a concrete override elsewhere wins.
	activation: onKey: bool | *false
}
