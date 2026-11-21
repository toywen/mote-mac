#!/usr/bin/env node
// Generates a 10,000 note test vault matching the statistical distributions of Downloads/workspace.
// Usage: node tools/gen-vault.mjs [output-dir] [count]
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const outDir = process.argv[2] || 'tmp/vault-10k'
const targetCount = Number(process.argv[3]) || 10000

const FOLDERS = [
  '00_Inbox',
  '01_Projects/Frontend',
  '01_Projects/Backend',
  '01_Projects/Design',
  '02_Areas/Health',
  '02_Areas/Finance',
  '02_Areas/Learning',
  '03_Resources/Books',
  '03_Resources/Articles',
  '03_Resources/Tools',
  '04_Archive/2025',
  '04_Archive/2026',
  'Daily',
  'Wiki/Concepts',
  'Wiki/Technologies',
  'Notes'
]

// Simple seeded PRNG for reproducible generation
let seed = 42
function rand() {
  seed = (seed * 16807) % 2147483647
  return (seed - 1) / 2147483646
}

function randInt(min, max) {
  return Math.floor(rand() * (max - min + 1)) + min
}

async function main() {
  console.log(`Generating ${targetCount} notes in ${outDir}...`)
  const start = Date.now()

  await mkdir(join(outDir, '.obsidian'), { recursive: true })
  await writeFile(
    join(outDir, '.obsidian', 'app.json'),
    JSON.stringify({ alwaysUpdateLinks: true }, null, 2)
  )

  for (const folder of FOLDERS) {
    await mkdir(join(outDir, folder), { recursive: true })
  }

  // Pre-generate note list so links can point to real notes
  const notes = []
  // Note 0 is the designated hub note with exactly 100 inbound backlinks
  notes.push({ path: '00_Inbox/Hub-Note.md', name: 'Hub-Note' })

  for (let i = 1; i < targetCount; i++) {
    const folder = FOLDERS[i % FOLDERS.length]
    const name = `Note-${String(i).padStart(5, '0')}`
    notes.push({ path: `${folder}/${name}.md`, name })
  }

  // Indices 1 to 100 link to Hub-Note
  const hubLinkingIndices = new Set()
  for (let i = 1; i <= 100; i++) {
    hubLinkingIndices.add(i)
  }

  // Write files in parallel batches
  const batchSize = 100
  for (let b = 0; b < notes.length; b += batchSize) {
    const batch = notes.slice(b, b + batchSize)
    await Promise.all(
      batch.map(async (note, idx) => {
        const globalIdx = b + idx
        const lines = []

        // 75% frontmatter
        if (rand() < 0.75) {
          lines.push('---')
          lines.push(`title: "${note.name}"`)
          lines.push(`date_added: "2026-11-21"`)
          lines.push(`type: "concept"`)
          lines.push(`tags: [knowledge, test, mote]`)
          lines.push('---')
          lines.push('')
        }

        lines.push(`# ${note.name}`)
        lines.push('')
        lines.push('这是一个用于测试大规模笔记库性能与响应速度的自动化生成笔记。')
        lines.push('在面对上万篇笔记时，编辑器与索引层必须保持低延迟与高吞吐。')
        lines.push('')

        // Designated link to Hub-Note
        if (hubLinkingIndices.has(globalIdx)) {
          lines.push(`重要引用链接：[[Hub-Note]]，用于压测反向链接查询与改名重写。`)
          lines.push('')
        }

        // Random wikilinks (avg ~1.8 per note), pick targets from index 1 onwards so Hub-Note has exactly 100 links
        const linkCount = randInt(0, 3)
        for (let l = 0; l < linkCount; l++) {
          const targetNote = notes[randInt(1, notes.length - 1)]
          if (targetNote.name !== note.name) {
            lines.push(`相关参考：[[${targetNote.name}]]。`)
          }
        }
        lines.push('')

        // 50% callout
        if (rand() < 0.5) {
          const types = ['info', 'tip', 'warning', 'note']
          const type = types[randInt(0, types.length - 1)]
          lines.push(`> [!${type}] 关键要点`)
          lines.push(`> 笔记包含结构化摘要与上下文元信息。`)
          lines.push('')
        }

        // 45% table
        if (rand() < 0.45) {
          lines.push('| 项目 | 数值 | 状态 |')
          lines.push('| ---- | ---- | ---- |')
          lines.push(`| 指标 A | ${randInt(10, 100)} | 正常 |`)
          lines.push(`| 指标 B | ${randInt(100, 1000)} | 稳定 |`)
          lines.push('')
        }

        // 5% task
        if (rand() < 0.05) {
          lines.push('- [ ] 检查指标')
          lines.push('- [x] 验证链接')
          lines.push('')
        }

        // Pad body to average ~3KB - 5KB
        const paragraphs = randInt(2, 6)
        for (let p = 0; p < paragraphs; p++) {
          lines.push(
            `段落 ${p + 1}：在知识库与卡片盒笔记体系中，每个原子观点都应该自洽且具备与其他观点连接的能力。` +
              `通过双向链接网状结构，笔记库可以在涌现中形成丰富的关联网络。` +
              `性能测试通过对全量笔记建立索引，检验文本检索与图谱反向查询的极端表现。`
          )
          lines.push('')
        }

        await writeFile(join(outDir, note.path), lines.join('\n'), 'utf8')
      })
    )
  }

  const duration = ((Date.now() - start) / 1000).toFixed(2)
  console.log(`✓ Successfully generated ${targetCount} notes in ${duration}s.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
