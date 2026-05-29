#!/usr/bin/env python3
"""
Minesweeper Solver – Constraint Satisfaction + Probability Analysis

Board encoding:
  0-8  = revealed number (0 = empty)
  'F'  = flagged mine
  '?'  = unopened / unknown cell

The solver:
  1. Applies deterministic rules (trivial deductions)
  2. Enumerates valid mine configurations for frontier cells
  3. Computes per-cell mine probability
"""

import itertools
import sys
from typing import List, Tuple, Dict, Set, Optional


# ─── Board representation ────────────────────────────────────────────

# Cell values
UNKNOWN = '?'
FLAG = 'F'


def parse_board(raw: List[List]) -> List[List]:
    """Normalize a board: strings/ints → consistent types."""
    board = []
    for row in raw:
        new_row = []
        for cell in row:
            if cell == '?':
                new_row.append(UNKNOWN)
            elif cell == 'F':
                new_row.append(FLAG)
            else:
                new_row.append(int(cell))
        board.append(new_row)
    return board


def print_board(board, probabilities=None):
    """Pretty-print the board with optional mine probabilities."""
    rows = len(board)
    cols = len(board[0]) if rows else 0

    # Header
    print("\n    ", end="")
    for c in range(cols):
        print(f" {c:>3}", end="")
    print()
    print("    " + "----" * cols)

    for r in range(rows):
        print(f" {r:>2} |", end="")
        for c in range(cols):
            cell = board[r][c]
            if cell == UNKNOWN:
                if probabilities and (r, c) in probabilities:
                    p = probabilities[(r, c)]
                    if p >= 0.99:
                        print(" \033[91m ██\033[0m", end="")  # definite mine – red
                    elif p <= 0.01:
                        print(" \033[92m ✓ \033[0m", end="")  # definitely safe – green
                    else:
                        print(f" \033[93m{p:>3.0%}\033[0m", end="")  # probability – yellow
                else:
                    print("  ? ", end="")
            elif cell == FLAG:
                print(" \033[91m ⚑ \033[0m", end="")
            else:
                colors = {
                    1: "\033[94m",   # blue
                    2: "\033[92m",   # green
                    3: "\033[91m",   # red
                    4: "\033[95m",   # purple
                    5: "\033[33m",
                    6: "\033[36m",
                    7: "\033[90m",
                    8: "\033[37m",
                }
                color = colors.get(cell, "")
                reset = "\033[0m" if color else ""
                print(f" {color}{cell:>3}{reset}", end="")
        print()
    print()


# ─── Neighbor helpers ─────────────────────────────────────────────────

def neighbors(r: int, c: int, rows: int, cols: int) -> List[Tuple[int, int]]:
    """Return all valid neighbor coordinates."""
    result = []
    for dr in (-1, 0, 1):
        for dc in (-1, 0, 1):
            if dr == 0 and dc == 0:
                continue
            nr, nc = r + dr, c + dc
            if 0 <= nr < rows and 0 <= nc < cols:
                result.append((nr, nc))
    return result


# ─── Deterministic solver ─────────────────────────────────────────────

def get_constraints(board) -> List[Tuple[int, Set[Tuple[int, int]]]]:
    """
    Extract constraints: for each numbered cell, compute
    (remaining_mines, set_of_unknown_neighbors).
    """
    rows, cols = len(board), len(board[0])
    constraints = []
    for r in range(rows):
        for c in range(cols):
            cell = board[r][c]
            if not isinstance(cell, int) or cell == 0:
                continue
            nbrs = neighbors(r, c, rows, cols)
            flags = sum(1 for nr, nc in nbrs if board[nr][nc] == FLAG)
            unknowns = {(nr, nc) for nr, nc in nbrs if board[nr][nc] == UNKNOWN}
            remaining = cell - flags
            if unknowns:
                constraints.append((remaining, unknowns))
    return constraints


def deterministic_step(board) -> Tuple[Set[Tuple[int, int]], Set[Tuple[int, int]]]:
    """
    One pass of deterministic deduction.
    Returns (new_flags, new_safe) cells found.
    """
    constraints = get_constraints(board)
    new_flags = set()
    new_safe = set()

    for remaining, unknowns in constraints:
        if remaining == len(unknowns):
            # All unknowns are mines
            new_flags |= unknowns
        elif remaining == 0:
            # All unknowns are safe
            new_safe |= unknowns

    # Pairwise constraint reduction
    for i, (r1, u1) in enumerate(constraints):
        for j, (r2, u2) in enumerate(constraints):
            if i >= j:
                continue
            if u1.issubset(u2):
                diff = u2 - u1
                diff_mines = r2 - r1
                if diff_mines == len(diff):
                    new_flags |= diff
                elif diff_mines == 0:
                    new_safe |= diff
            elif u2.issubset(u1):
                diff = u1 - u2
                diff_mines = r1 - r2
                if diff_mines == len(diff):
                    new_flags |= diff
                elif diff_mines == 0:
                    new_safe |= diff

    return new_flags, new_safe


def solve_deterministic(board) -> Tuple[List[List], Set[Tuple[int, int]], Set[Tuple[int, int]]]:
    """
    Apply deterministic rules until no more progress.
    Returns (updated_board, all_flags_found, all_safe_found).
    """
    board = [row[:] for row in board]  # deep copy
    all_flags = set()
    all_safe = set()

    while True:
        new_flags, new_safe = deterministic_step(board)
        # Remove already known
        new_flags -= all_flags
        new_safe -= all_safe

        if not new_flags and not new_safe:
            break

        for r, c in new_flags:
            board[r][c] = FLAG
            all_flags.add((r, c))
        for r, c in new_safe:
            # Mark safe cells as revealed-0 for further deduction
            # (In a real game you'd click them; here we mark them to continue)
            board[r][c] = 0
            all_safe.add((r, c))

    return board, all_flags, all_safe


# ─── Probability solver (enumeration) ────────────────────────────────

def get_frontier_groups(board) -> Tuple[List[Set[Tuple[int, int]]], Set[Tuple[int, int]]]:
    """
    Find groups of unknown cells that are connected via constraints.
    Returns (groups, all_frontier_cells).
    """
    rows, cols = len(board), len(board[0])
    constraints = get_constraints(board)

    # Frontier = unknown cells adjacent to at least one number
    frontier = set()
    for _, unknowns in constraints:
        frontier |= unknowns

    # Build adjacency graph among frontier cells via shared constraints
    cell_to_constraints: Dict[Tuple[int, int], List[int]] = {}
    for idx, (_, unknowns) in enumerate(constraints):
        for cell in unknowns:
            cell_to_constraints.setdefault(cell, []).append(idx)

    # Connected components via BFS
    visited = set()
    groups = []
    for cell in frontier:
        if cell in visited:
            continue
        group = set()
        queue = [cell]
        while queue:
            current = queue.pop()
            if current in visited:
                continue
            visited.add(current)
            group.add(current)
            for cidx in cell_to_constraints.get(current, []):
                for neighbor_cell in constraints[cidx][1]:
                    if neighbor_cell not in visited:
                        queue.append(neighbor_cell)
        groups.append(group)

    return groups, frontier


def enumerate_group(board, group: Set[Tuple[int, int]]) -> List[Dict[Tuple[int, int], bool]]:
    """
    Enumerate all valid mine assignments for a frontier group.
    Returns list of valid configurations.
    """
    constraints = get_constraints(board)
    # Filter constraints relevant to this group
    relevant = [(r, u & group) for r, u in constraints if u & group]

    cells = sorted(group)
    valid_configs = []

    # Enumerate all 2^n possibilities (with pruning)
    for bits in range(2 ** len(cells)):
        assignment = {}
        for i, cell in enumerate(cells):
            assignment[cell] = bool(bits & (1 << i))

        # Check all constraints
        valid = True
        for remaining, unknowns in relevant:
            mine_count = sum(1 for c in unknowns if assignment.get(c, False))
            if mine_count != remaining:
                valid = False
                break

        if valid:
            valid_configs.append(assignment)

    return valid_configs


def compute_probabilities(board, total_mines: Optional[int] = None) -> Dict[Tuple[int, int], float]:
    """
    Compute mine probability for each unknown cell.
    Uses enumeration over frontier groups.
    """
    rows, cols = len(board), len(board[0])
    groups, frontier = get_frontier_groups(board)
    probabilities = {}

    for group in groups:
        if len(group) > 25:
            # Too large for brute force – use sampling or skip
            print(f"  ⚠ Group of {len(group)} cells too large for exact enumeration, using heuristic")
            constraints = get_constraints(board)
            for cell in group:
                # Simple heuristic: average constraint pressure
                relevant = [(r, u) for r, u in constraints if cell in u]
                if relevant:
                    avg_pressure = sum(r / len(u) for r, u in relevant) / len(relevant)
                    probabilities[cell] = avg_pressure
                else:
                    probabilities[cell] = 0.5
            continue

        configs = enumerate_group(board, group)
        if not configs:
            print(f"  ⚠ No valid configurations for group – board may be inconsistent")
            for cell in group:
                probabilities[cell] = 0.5
            continue

        for cell in group:
            mine_count = sum(1 for cfg in configs if cfg[cell])
            probabilities[cell] = mine_count / len(configs)

    # Non-frontier unknowns (not adjacent to any number)
    all_unknowns = {(r, c) for r in range(rows) for c in range(cols) if board[r][c] == UNKNOWN}
    non_frontier = all_unknowns - frontier
    for cell in non_frontier:
        # Without more info, assign a default probability
        # Could be refined with total mine count
        probabilities[cell] = 0.5  # unknown – no info

    return probabilities


# ─── Main solver ──────────────────────────────────────────────────────

def solve(board, total_mines: Optional[int] = None):
    """Full solver pipeline."""
    print("=" * 60)
    print("  MINESWEEPER SOLVER")
    print("=" * 60)

    print("\n📋 Original Board:")
    print_board(board)

    # Step 1: Deterministic
    print("🔍 Phase 1: Deterministic deduction...")
    solved_board, det_flags, det_safe = solve_deterministic(board)
    if det_flags:
        print(f"   Found {len(det_flags)} definite mine(s): {sorted(det_flags)}")
    if det_safe:
        print(f"   Found {len(det_safe)} safe cell(s): {sorted(det_safe)}")
    if not det_flags and not det_safe:
        print("   No trivial deductions possible.")

    # Step 2: Probability
    print("\n📊 Phase 2: Probability analysis...")
    probabilities = compute_probabilities(solved_board, total_mines)

    if probabilities:
        print("\n📋 Board with mine probabilities:")
        print_board(solved_board, probabilities)

        # Summary
        print("─" * 60)
        print("  RECOMMENDATIONS")
        print("─" * 60)

        safe_cells = [(cell, p) for cell, p in probabilities.items() if p <= 0.01]
        danger_cells = [(cell, p) for cell, p in probabilities.items() if p >= 0.99]
        uncertain = [(cell, p) for cell, p in probabilities.items() if 0.01 < p < 0.99]
        uncertain.sort(key=lambda x: x[1])

        if safe_cells:
            print(f"\n  ✅ SAFE to click ({len(safe_cells)}):")
            for (r, c), p in sorted(safe_cells):
                print(f"     Row {r}, Col {c}")

        if danger_cells:
            print(f"\n  💣 DEFINITE MINES ({len(danger_cells)}):")
            for (r, c), p in sorted(danger_cells):
                print(f"     Row {r}, Col {c}")

        if uncertain:
            print(f"\n  🎲 UNCERTAIN (sorted by risk, lowest first):")
            for (r, c), p in uncertain[:10]:
                bar = "█" * int(p * 20) + "░" * (20 - int(p * 20))
                print(f"     Row {r}, Col {c}: {p:>5.1%} [{bar}]")
            if len(uncertain) > 10:
                print(f"     ... and {len(uncertain) - 10} more")

            best = uncertain[0]
            print(f"\n  👉 Best move: click Row {best[0][0]}, Col {best[0][1]} ({best[1]:.1%} mine chance)")
    else:
        print("   No unknown cells remaining – board solved!")

    return solved_board, probabilities


# ─── Example: Board from screenshot ──────────────────────────────────

if __name__ == "__main__":
    # Board from the user's screenshot (best reading)
    # Legend: 0-8 = number, 'F' = flag, '?' = unknown/covered
    #
    # This is my best reading of the screenshot.
    # Adjust any cells that are incorrect!

    board_raw = [
        # Col:  0    1    2    3    4    5    6    7    8    9   10
        [  2,   3,   2,   2,   2,   3,   3, '?',  1,   1,   1],  # Row 0
        ['F',   2, 'F',   1, 'F',   1,   2,   2,   2,   1,   1],  # Row 1
        [  2,   2,   2,   2,   3,   3,   3,   2,   1,   3,   3,   2],  # Row 2
        [  2,   1,   1,   1,   2, 'F',   1,   3,   2,   1, '?', '?'],  # Row 3
        [  1,   1,   2,   1,   3,   3,   1,   4,   1, '?',   1, '?'],  # Row 4
        [  1,   1, '?',   2,   1,   1,   3,   3,   1,   4,   1, '?',   2],  # Row 5 - note: 13 cols? screenshot edge
        ['?',   1,   2,   3,   3, '?', '?',   3, '?',   1,   1],  # Row 6
        [  1,   1, '?',   1,   1,   1, '?', '?',   2,   1,   2, '?'],  # Row 7
    ]

    # Normalize row lengths (pad with '?' if needed)
    max_cols = max(len(row) for row in board_raw)
    for row in board_raw:
        while len(row) < max_cols:
            row.append('?')

    board = parse_board(board_raw)
    solve(board)

    print("\n" + "=" * 60)
    print("  HOW TO USE WITH YOUR OWN BOARD")
    print("=" * 60)
    print("""
  1. Edit the board_raw array above with your board state
  2. Use integers (1-8) for revealed numbers
  3. Use 'F' for flagged mines
  4. Use '?' for unknown/covered cells
  5. Run: python3 minesweeper_solver.py
    """)
