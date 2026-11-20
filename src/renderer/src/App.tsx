function App(): React.JSX.Element {
  return (
    <div className="layout">
      <aside className="pane sidebar">文件树</aside>
      <main className="pane editor">编辑器</main>
      <aside className="pane backlinks">反向链接</aside>
    </div>
  )
}

export default App
