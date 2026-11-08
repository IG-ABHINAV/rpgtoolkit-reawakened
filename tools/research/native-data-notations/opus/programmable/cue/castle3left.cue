// #1778 research (Opus), AUTHORED: generates the six real placements of
// Crystal Immortality's castle3left board (projection scenes/castle3left) from
// a drill-grid rule plus a shared placement template. Evaluate with:
//   cue export castle3left.cue soldiers.cue --out json
package scene

kind: "scene"
id:   "castle3left"
size: {width: 19, height: 19, layers: 8}

// Grid rule: two columns, three rows, 96 px apart. Values are COMPUTED.
_columns: [{actor: "train-soldier1", x: 208, prg: "scripts/train sold1.prg"},
	{actor: "train-soldier2", x: 400, prg: "scripts/train sold2.prg"}]

placements: [for row in [0, 1, 2] for col in _columns {
	#Placement & {
		id:    "\(col.actor)-\(row+1)"
		actor: col.actor
		at:    [col.x, 319 + 96*row, 1]
		whilePresent: program: col.prg
	}
}]
