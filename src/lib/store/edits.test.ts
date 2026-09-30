import { describe, expect, it } from 'vitest'
import { diffText, mapLines, mapRange, remapLineRecord } from './edits'

describe('diffText', () => {
  it('finds a single contiguous change', () => {
    expect(diffText('hello world', 'hello big world')).toEqual({ from: 6, oldTo: 6, newTo: 10 })
    expect(diffText('abc', 'abc')).toBeNull()
    expect(diffText('aaa', 'aa')).toEqual({ from: 2, oldTo: 3, newTo: 2 })
  })
})

describe('mapRange', () => {
  const range = { start: 6, end: 11, id: 'x' } // "world" in "hello world"

  it('shifts ranges after an insertion', () => {
    const edit = diffText('hello world', 'oh hello world')!
    expect(mapRange(range, edit)).toMatchObject({ start: 9, end: 14 })
  })

  it('does not grow when typing at the edges', () => {
    expect(mapRange(range, diffText('hello world', 'hello new world')!)).toMatchObject({ start: 10, end: 15 })
    expect(mapRange(range, diffText('hello world', 'hello world!')!)).toMatchObject({ start: 6, end: 11 })
  })

  it('keeps replaced text inside the range', () => {
    const edit = diffText('hello world', 'hello wonderful')!
    expect(mapRange(range, edit)).toMatchObject({ start: 6, end: 15 })
  })

  it('drops a range whose text was deleted', () => {
    expect(mapRange(range, diffText('hello world', 'hello ')!)).toBeNull()
  })
})

describe('mapLines', () => {
  it('keeps edited lines and shifts lines after inserted ones', () => {
    const map = mapLines('a\nb\nc', 'a\nnew\nb\nc')
    expect([0, 1, 2].map(map)).toEqual([0, 2, 3])
  })

  it('keeps a line number when the line is edited in place', () => {
    const map = mapLines('a\nb\nc', 'a\nb changed\nc')
    expect([0, 1, 2].map(map)).toEqual([0, 1, 2])
  })

  it('drops deleted lines', () => {
    const map = mapLines('a\nb\nc\nd', 'a\nd')
    expect([0, 1, 2, 3].map(map)).toEqual([0, null, null, 1])
  })

  it('re-keys per-line records', () => {
    expect(remapLineRecord({ 1: 'x', 2: 'y' }, 'a\nb\nc', 'top\na\nb\nc')).toEqual({ 2: 'x', 3: 'y' })
  })
})

describe('paintHighlight', () => {
  it('replaces, trims and erases marks', async () => {
    const { paintHighlight, trimRange, lineRange } = await import('./highlights')
    let list = paintHighlight([], 0, 10, 'favorite')
    list = paintHighlight(list, 4, 6, 'punchline')
    expect(list.map((h) => [h.start, h.end, h.kind])).toEqual([
      [0, 4, 'favorite'],
      [4, 6, 'punchline'],
      [6, 10, 'favorite'],
    ])
    list = paintHighlight(list, 0, 5, null)
    expect(list.map((h) => [h.start, h.end, h.kind])).toEqual([
      [5, 6, 'punchline'],
      [6, 10, 'favorite'],
    ])
    expect(trimRange('  hi there ', 0, 11)).toEqual({ start: 2, end: 10 })
    expect(lineRange('one\n  two  \nthree', 6)).toEqual({ start: 6, end: 9 })
  })
})
