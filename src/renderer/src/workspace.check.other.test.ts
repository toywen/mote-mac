import { verify } from './workspace.check'

verify([
  'another window renames the open note while you type',
  'switch notes and close the window while you type',
  'open a note again after a link put the cursor in it',
  'a write fails with a disk error'
])
