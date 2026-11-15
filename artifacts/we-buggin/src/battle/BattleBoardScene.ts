import Phaser from "phaser";
import { COLS, GEM_TYPES, ROWS, type Board, type Cell, type GemType } from "./battle-engine";

const SIZE = 400;
const INSET = 8;
const CELL = (SIZE - INSET * 2) / COLS;

export interface BoardView {
  board: Board;
  selected: Cell | null;
  targetMode: "board" | "ally" | "enemy" | null;
  lockedGems: Cell[];
}

export class BattleBoardScene extends Phaser.Scene {
  private sprites: Phaser.GameObjects.Image[][] = [];
  private marks!: Phaser.GameObjects.Graphics;
  private vines!: Phaser.GameObjects.Graphics;
  private view: BoardView | null = null;
  ready = false;

  constructor(private readonly onCellTap: (cell: Cell) => void) {
    super({ key: "BattleBoard" });
  }

  preload() {
    for (const type of GEM_TYPES) {
      const filename = type === "sword" ? "gem_sword.png" : `gem_${type}.png`;
      this.load.image(type, `${import.meta.env.BASE_URL}battle-assets/gems/${filename}`);
    }
  }

  create() {
    this.marks = this.add.graphics();
    this.sprites = Array.from({ length: ROWS }, (_, row) =>
      Array.from({ length: COLS }, (_, col) => {
        const sprite = this.add.image(INSET + col * CELL + CELL / 2, INSET + row * CELL + CELL / 2, "red");
        sprite.setDisplaySize(CELL * 0.82, CELL * 0.82);
        return sprite;
      }));
    this.vines = this.add.graphics();

    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      const col = Math.floor((pointer.x - INSET) / CELL);
      const row = Math.floor((pointer.y - INSET) / CELL);
      if (row >= 0 && row < ROWS && col >= 0 && col < COLS) this.onCellTap({ row, col });
    });
    this.cameras.main.setBackgroundColor("#0a0908");
    this.ready = true;
    if (this.view) this.renderView(this.view);
  }

  setView(view: BoardView) {
    this.view = view;
    if (this.ready) this.renderView(view);
  }

  private renderView(view: BoardView) {
    this.marks.clear();
    this.vines.clear();
    this.marks.fillStyle(0x15120e, 1);
    this.marks.fillRect(0, 0, SIZE, SIZE);
    this.marks.fillStyle(0x393025, 1);
    this.marks.fillRect(INSET - 2, INSET - 2, SIZE - (INSET - 2) * 2, SIZE - (INSET - 2) * 2);

    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        const x = INSET + col * CELL;
        const y = INSET + row * CELL;
        const baseColor = (row + col) % 2 === 0 ? 0x221d16 : 0x2b241b;
        this.marks.fillStyle(baseColor, 1);
        this.marks.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);

        const gem: GemType = view.board[row][col];
        const sprite = this.sprites[row][col];
        sprite.setTexture(gem);
        sprite.setPosition(x + CELL / 2, y + CELL / 2);
        sprite.setDisplaySize(CELL * (gem === "sword" ? 0.84 : 0.78), CELL * (gem === "sword" ? 0.84 : 0.78));

        if (view.selected?.row === row && view.selected.col === col) {
          this.marks.lineStyle(3, 0xffdf82, 1);
          this.marks.strokeRect(x + 2, y + 2, CELL - 4, CELL - 4);
        } else if (view.targetMode === "board") {
          this.marks.lineStyle(1.5, 0x78c9ff, 0.75);
          this.marks.strokeRect(x + 2, y + 2, CELL - 4, CELL - 4);
        }
      }
    }

    for (const cell of view.lockedGems) {
      const x = INSET + cell.col * CELL;
      const y = INSET + cell.row * CELL;
      this.vines.fillStyle(0x17351d, 0.35);
      this.vines.fillRoundedRect(x + 3, y + 3, CELL - 6, CELL - 6, 5);
      this.vines.lineStyle(2.4, 0x83b851, 0.98);
      this.vines.beginPath();
      this.vines.moveTo(x + 5, y + CELL - 6);
      this.vines.lineTo(x + CELL * 0.38, y + CELL * 0.63);
      this.vines.lineTo(x + CELL * 0.6, y + CELL * 0.36);
      this.vines.lineTo(x + CELL - 5, y + 6);
      this.vines.strokePath();
      this.vines.lineStyle(1.6, 0xc0d879, 0.95);
      this.vines.beginPath();
      this.vines.moveTo(x + 6, y + 6);
      this.vines.lineTo(x + CELL * 0.38, y + CELL * 0.38);
      this.vines.lineTo(x + CELL * 0.62, y + CELL * 0.64);
      this.vines.lineTo(x + CELL - 6, y + CELL - 6);
      this.vines.strokePath();
      this.vines.fillStyle(0xc0d879, 0.95);
      this.vines.fillEllipse(x + CELL * 0.34, y + CELL * 0.25, 7, 3);
      this.vines.fillEllipse(x + CELL * 0.68, y + CELL * 0.73, 7, 3);
    }
  }
}
