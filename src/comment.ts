import { Text, Line } from "@codemirror/next/text"
import { EditorState, Transaction, SelectionRange, Change, StateCommand } from "@codemirror/next/state"

/// Comments or uncomments the current `SelectionRange` using line-comments.
/// The line-comment token is defined on a language basis.
export const toggleLineComment: StateCommand = target => {
  return dispatch(toggleLineCommentWithOption(CommentOption.Toggle), target)
}

/// Comments the current `SelectionRange` using line-comments.
/// The line-comment token is defined on a language basis.
export const lineComment: StateCommand = target => {
  return dispatch(toggleLineCommentWithOption(CommentOption.OnlyComment), target)
}

/// Uncomments the current `SelectionRange` using line-comments.
/// The line-comment token is defined on a language basis.
export const lineUncomment: StateCommand = target => {
  return dispatch(toggleLineCommentWithOption(CommentOption.OnlyUncomment), target)
}

/// Comments or uncomments the current `SelectionRange` using block-comments.
/// The block-comment tokens are defined on a language basis.
export const toggleBlockComment: StateCommand = target => {
  return dispatch(toggleBlockCommentWithOption(CommentOption.Toggle), target)
}

/// Comments the current `SelectionRange` using block-comments.
/// The block-comment tokens are defined on a language basis.
export const blockComment: StateCommand = target => {
  return dispatch(toggleBlockCommentWithOption(CommentOption.OnlyComment), target)
}

/// Uncomments the current `SelectionRange` using block-comments.
/// The block-comment tokens are defined on a language basis.
export const blockUncomment: StateCommand = target => {
  return dispatch(toggleBlockCommentWithOption(CommentOption.OnlyUncomment), target)
}

const dispatch = (cmd: (st: EditorState) => Transaction | null, target: { state: EditorState, dispatch: (transaction: Transaction) => void }): boolean => {
  const tr = cmd(target.state)
  if (!tr) return false
  target.dispatch(tr)
  return true
}

/// @internal
export enum CommentOption {
  Toggle,
  OnlyComment,
  OnlyUncomment,
}

/// @internal
export const toggleBlockCommentWithOption = (option: CommentOption) => (state: EditorState): Transaction | null => {
  type BlockCommentData = { blockComment: { open: string, close: string } | undefined } | undefined
  const data = state.languageDataAt<BlockCommentData>("commentTokens", state.selection.primary.from)[0]
  return data === undefined || data.blockComment === undefined || data.blockComment.open === undefined || data.blockComment.close === undefined
    ? null
    : new BlockCommenter(data.blockComment.open, data.blockComment.close).toggle(option, state)
}

/// @internal
export const toggleLineCommentWithOption = (option: CommentOption) => (state: EditorState): Transaction | null => {
  type LineCommentData = { lineComment: string | undefined } | undefined
  const data = state.languageDataAt<LineCommentData>("commentTokens", state.selection.primary.from)[0]
  return data === undefined || data.lineComment === undefined
    ? null
    : new LineCommenter(data.lineComment).toggle(option, state)
}

/// This class performs toggle, comment and uncomment
/// of block comments in languages that support them.
/// The `open` and `close` arguments refer to the open and close
/// tokens of which this `BlockCommenter` is made up.
/// @internal
export class BlockCommenter {
  constructor(readonly open: string, readonly close: string, readonly margin: string = " ") { }

  toggle(option: CommentOption, state: EditorState): Transaction | null {
    const selectionCommented = this.isSelectionCommented(state)
    if (selectionCommented !== null) {
      if (option !== CommentOption.OnlyComment) {
        const tr = state.t()
        const mapRef = tr.mapRef()
        for (const range of selectionCommented) {
          const open = range.open
          const close = range.close
          open.pos = mapRef.mapPos(open.pos)
          tr.replace(open.pos - this.open.length, open.pos + open.margin, "")
          close.pos = mapRef.mapPos(close.pos)
          tr.replace(close.pos - close.margin, close.pos + this.close.length, "")
        }

        return tr
      }
    } else {
      if (option !== CommentOption.OnlyUncomment) {
        const tr = state.t()
        tr.forEachRange((range: SelectionRange, tr: Transaction) => {
          const copen = new Change(range.from, range.from, tr.startState.splitLines(this.open + this.margin))
          const cclose = new Change(range.to, range.to, tr.startState.splitLines(this.margin + this.close))
          tr.change([copen, cclose])
          const shift = (this.open + this.margin).length
          return new SelectionRange(range.anchor + shift, range.head + shift)
        })

        return tr
      }
    }

    return null
  }

  /// Determines whether all selection ranges in `state` are block-commented.
  isSelectionCommented(state: EditorState): { open: { pos: number, margin: number }, close: { pos: number, margin: number } }[] | null {
    let result = []
    for (const range of state.selection.ranges) {
      const x = this.isRangeCommented(state, range)
      if (x === null) return null
      result.push(x)
    }
    return result
  }

  /// Determines if the `range` is block-commented in the given `state`.
  /// The `range` must be a valid range in `state`.
  isRangeCommented(state: EditorState, range: SelectionRange): { open: { pos: number, margin: number }, close: { pos: number, margin: number } } | null {
    type SearchWithType = (str: string, searchString: string, pos: number) => boolean
    const search = (pos: number, searchString: string, searchWith: SearchWithType, d: 1 | -1, i: 1 | 0): { pos: number, margin: number } | null => {
      const line = state.doc.lineAt(pos)
      const str = line.slice()
      const ss = eatSpace(str, pos - line.start - i, d)
      return searchWith(str, searchString, pos + d * ss - line.start)
        ? { pos: pos + d * ss, margin: ss == 0 ? 0 : 1 }
        : null
    }
    const startsWithOpen = search(range.from, this.open, finishesWith, -1, 1)
    const endsWithClose = search(range.to, this.close, beginsWith, 1, 0)
    return startsWithOpen !== null && endsWithClose !== null
      ? { open: startsWithOpen, close: endsWithClose }
      : null
  }

}

/// This class performs toggle, comment and uncomment
/// of line comments in languages that support them.
/// The `lineCommentToken` argument refer to the token of
/// which this `LineCommenter` is made up.
/// @internal
export class LineCommenter {
  constructor(readonly lineCommentToken: string, readonly margin: string = " ") { }

  toggle(option: CommentOption, state: EditorState): Transaction | null {
    const linesAcrossSelection: Line[] = []
    const linesAcrossRange: { [id: number]: Line[]; } = {};
    for (let i = 0; i < state.selection.ranges.length; i++) {
      const lines = getLinesInRange(state.doc, state.selection.ranges[i])
      linesAcrossSelection.push(...lines)
      linesAcrossRange[i] = lines
    }
    const column = this.isRangeCommented(state, linesAcrossSelection)
    if (column.isRangeLineSkipped) {
      if (option != CommentOption.OnlyComment) {
        const tr = state.t()
        const mapRef = tr.mapRef()
        for (let i = 0; i < state.selection.ranges.length; i++) {
          const lines = linesAcrossRange[i]
          for (const line of lines) {
            if (lines.length > 1 && column.isLineSkipped[line.number]) continue
            const pos = mapRef.mapPos(line.start + column.minCol)
            const marginLen = beginsWith(line.slice(), " ", column.minCol + this.lineCommentToken.length) ? 1 : 0
            tr.replace(pos, pos + this.lineCommentToken.length + marginLen, "")
          }
        }
        return tr
      }
    } else {
      if (option != CommentOption.OnlyUncomment) {
        const tr = state.t()
        const mapRef = tr.mapRef()
        for (let i = 0; i < state.selection.ranges.length; i++) {
          const lines = linesAcrossRange[i]
          for (const line of lines) {
            if (lines.length > 1 && column.isLineSkipped[line.number]) continue
            const pos = mapRef.mapPos(line.start + column.minCol)
            tr.replace(pos, pos, this.lineCommentToken + this.margin)
          }
        }
        return tr
      }
    }

    return null
  }

  isRangeCommented(state: EditorState, lines: Line[]): { minCol: number } & { isRangeLineSkipped: boolean } & { isLineSkipped: { [id: number]: boolean } } {
    let minCol = Infinity
    let isRangeLineDiscarded = true
    const isLineSkipped: { [id: number]: boolean } = []
    for (const line of lines) {
      const str = line.slice()
      const col = eatSpace(str)
      if ((lines.length == 1 || col < str.length) && col < minCol) {
        minCol = col
      }
      if (isRangeLineDiscarded && (lines.length == 1 || col < str.length) && !beginsWith(str, this.lineCommentToken, col)) {
        isRangeLineDiscarded = false
      }
      isLineSkipped[line.number] = col == str.length
    }
    return { minCol: minCol, isRangeLineSkipped: isRangeLineDiscarded, isLineSkipped: isLineSkipped }
  }

}

/// Computes the lines spanned by `range`.
/// This function is exported mostly for testing purposes.
/// @internal
export function getLinesInRange(doc: Text, range: SelectionRange): Line[] {
  let line: Line = doc.lineAt(range.from)
  const lines = []
  while (line.start + line.length < range.to ||
    (line.start <= range.to && range.to <= line.end)) {
    lines.push(line)
    if (line.number + 1 <= doc.lines) {
      line = doc.line(line.number + 1)
    } else {
      break
    }
  }
  return lines
}

function eatSpace(str: string, pos: number = 0, direction: 1 | -1 = 1): number {
  let count = 0
  while (/[\s\u00a0]/.test(str.charAt(pos))) {
    count++
    pos += direction
  }
  return count
}

function beginsWith(str: string, searchString: string, pos: number): boolean {
  let searchPos = 0
  while (pos < str.length && searchPos < searchString.length && str.charAt(pos) == searchString.charAt(searchPos)) {
    pos++
    searchPos++
  }
  return searchPos == searchString.length
}

function finishesWith(str: string, searchString: string, length: number): boolean {
  return beginsWith(str, searchString, length - searchString.length)
}
