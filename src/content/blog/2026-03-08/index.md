---
title: "Map 为什么不能并发读写：从哈希结构到扩容机制"
seoTitle: "Map 为什么不能并发读写：从哈希结构到扩容机制 | Gavin's Blog"
description: "从后端工程视角理解 Go map 的哈希定位、冲突处理、扩容、删除和并发边界，解释它为什么好用但不能随便并发读写。"
pubDate: 2026-03-08
tags:
  - Go系列
  - Map
  - 并发
---

## 前言

写 Go 代码时，`map` 和 `slice` 一样常见。

但它们容易出问题的地方不太一样。

`slice` 的麻烦，很多来自底层数组共享和 `append` 扩容。

`map` 的麻烦，则更多来自它内部是一个会动态变化的哈希结构。

比如：

- 为什么 `map` 查找很快？
- 为什么 `map` 遍历顺序是不稳定的？
- 为什么 `delete` 之后内存不一定马上降下来？
- 为什么普通 `map` 不能并发读写？
- 为什么一段代码看起来只是“读一下 map”，线上却可能因为并发写直接崩掉？

这些问题表面上分散，背后其实都指向同一件事：

> Go 的 map 不是一个静态数组，而是一个由 runtime 维护的动态哈希表。

它为了让日常读写足够快，内部会做哈希定位、冲突处理、扩容和数据搬迁。

这些机制让 `map` 很好用，但也决定了它在并发场景里不能被当成普通共享变量随便操作。

这一篇就沿着这条主线，梳理 Go `map` 的底层行为，以及它为什么在工程里经常成为并发安全和内存问题的边界。

## 一、map 解决的核心问题是什么？

`map` 解决的是一种非常常见的需求：

> 通过一个 key，快速找到对应的 value。

如果用数组或切片做这件事，最直接的方式是从头扫到尾：

```go
for _, item := range items {
    if item.ID == targetID {
        return item
    }
}
```

这种方式很直观，但问题也明显：

- 数据越多，查找越慢
- 每次查找都可能要扫描大量元素
- key 不一定是连续整数，不能直接当数组下标

哈希表的思路是换一种方式：

> 先把 key 通过哈希函数转成一个数字，再用这个数字定位到内部存储位置。

简化一下，可以理解成：

```text
key -> hash(key) -> position -> value
```

这样查找时就不需要从头扫到尾。

理想情况下，一次哈希定位后，就能很快找到目标位置。

这也是 `map` 日常使用很方便的原因：

```go
user := users[userID]
```

这行代码背后，runtime 实际做了不少事：

- 计算 key 的哈希值
- 根据哈希结果定位存储区域
- 在候选位置里比较 key
- 找到对应 value 或判断不存在

所以 `map` 看起来像“通过 key 直接取值”，但它不是魔法，本质还是一套哈希表机制。

## 二、key 是怎么找到 value 的？

理解 `map`，先要理解哈希定位。

假设有这样一个 map：

```go
scores := map[string]int{
    "alice": 90,
    "bob":   80,
}
```

当你访问：

```go
scores["alice"]
```

runtime 不会真的拿 `"alice"` 去逐个比较所有 key。

更接近真实的过程是：

```text
"alice"
   ↓
hash("alice")
   ↓
定位到某一组候选位置
   ↓
比较 key，找到 value
```

为什么最后还要比较 key？

因为哈希值不是最终答案。

不同的 key 可能算出相同或相近的定位结果，这就是哈希冲突。

所以哈希表不能只看位置，还要在候选位置里确认：

> 这里存的 key 到底是不是我要找的那个 key？

这也是为什么 `map` 的 key 必须是可比较的。

比如这些可以作为 key：

- `int`
- `string`
- `bool`
- 指针
- 包含可比较字段的结构体

而这些不能直接作为 key：

- `slice`
- `map`
- `function`

原因很直接：

> runtime 找到候选位置之后，还需要判断 key 是否相等。

如果一个类型本身不能比较，就没有办法稳定完成这一步。

## 三、哈希冲突为什么不可避免？

哈希函数会把很大的 key 空间映射到有限的存储空间里。

只要数据足够多，冲突就一定会出现。

比如可以简化理解成：

```text
hash("alice") -> 3
hash("tom")   -> 3
```

这两个 key 最后都落到了同一片候选区域。

这时哈希表需要解决两个问题：

- 怎么把冲突的 key 都放进去？
- 查找时怎么从这些候选项里找到真正的目标？

不同版本的 Go runtime，具体实现细节会调整。

早期资料里经常会讲 `hmap`、`bmap`、bucket、overflow bucket：

- 一个 bucket 里放多个 key/value
- 冲突太多时挂 overflow bucket
- 查找时先定位 bucket，再在 bucket 和 overflow 链上比较 key

这个模型对理解旧版 Go map 很有帮助。

但从 Go 1.24 开始，内置 `map` 的实现已经切换到 Swiss Tables 风格。

新的实现不再适合只用“一个 bucket 挂一串 overflow bucket”来描述。

它更强调分组存储、控制字节和探测序列，用更好的局部性和更少的无效比较来提升查找效率。

不过对写业务代码来说，需要抓住的核心并没有变：

> map 通过哈希定位缩小查找范围，再通过 key 比较解决冲突。

实现可以演进，但这条主线是稳定的。

## 四、为什么 map 会扩容？

`map` 不是创建之后大小就固定不变。

随着元素越来越多，它迟早会遇到两个问题：

- 存储空间不够
- 冲突变多，查找效率下降

如果一个哈希表太满，很多 key 会落到拥挤的位置。

这会让一次查找变成：

```text
定位位置 -> 发现不是 -> 继续探测或查找候选项 -> 继续比较
```

冲突越多，查找和插入成本就越高。

所以 `map` 需要扩容。

扩容的本质不是单纯“申请更大内存”，而是：

> 重新组织 key/value 的分布，让哈希表重新变得稀疏和高效。

这件事比 slice 扩容更复杂。

`slice` 扩容大致是：

```text
分配新数组 -> 拷贝旧元素 -> 返回新 slice
```

但 `map` 扩容涉及哈希分布变化。

旧位置里的 key，放到新结构里以后，位置可能会变。

也就是说，扩容时不只是搬内存，还要重新安排数据。

这也是为什么 `map` 内部状态在写入过程中会发生复杂变化。

## 五、为什么扩容通常不会一次搬完？

如果一个 `map` 很大，一次性把所有数据都搬到新结构里，会带来明显的停顿。

比如一个缓存 map 里有几十万甚至几百万个 key，如果某次写入触发扩容，然后 runtime 在这一刻把所有 key/value 都重新搬一遍，那这次操作会非常重。

Go runtime 通常不会用这种粗暴方式处理。

更合理的做法是渐进式搬迁：

> 扩容开始后，后续读写操作会顺手推进一部分迁移工作，而不是在某一刻一次性搬完。

这样可以把一次巨大的成本摊到多次操作中。

对业务代码来说，你不需要记住每一个内部字段，但要理解这个后果：

> map 写入不只是把一个 key/value 塞进去，它可能顺带触发扩容和迁移。

这就是为什么并发读写 `map` 特别危险。

因为当一个 goroutine 正在读 map，另一个 goroutine 正在写 map 时，写操作可能正在修改内部结构。

读操作如果同时观察到一个中间状态，就可能读到不一致的数据结构。

## 六、为什么普通 map 不能并发读写？

Go 的普通 `map` 不是并发安全的。

最常见的错误是：

```go
var cache = map[string]int{}

func write() {
    cache["a"] = 1
}

func read() int {
    return cache["a"]
}
```

如果 `write` 和 `read` 被多个 goroutine 同时调用，就可能触发：

```text
fatal error: concurrent map read and map write
```

这个错误不是普通业务错误。

它是 runtime 发现了危险的并发访问，直接让程序崩掉。

为什么不能只把它理解成“读写同一个变量有点不安全”？

因为 `map` 的写操作可能改变内部结构：

- 插入新 key
- 更新已有 value
- 标记删除状态
- 触发扩容
- 推进数据迁移
- 调整内部探测状态

这些动作都可能改变读操作依赖的数据结构。

所以并发读写的风险不是“读到旧值”这么简单，而是：

> 一个 goroutine 正在按照旧结构读，另一个 goroutine 正在改变这套结构。

这会破坏 runtime 对 `map` 内部一致性的假设。

所以 Go 对普通 `map` 的态度很明确：

> 只要有并发写，就必须由你自己负责同步。

## 七、只有并发读可以吗？

多个 goroutine 同时读同一个 `map`，在没有写操作的前提下通常是可以的。

比如：

```go
var config map[string]string

func get(key string) string {
    return config[key]
}
```

如果 `config` 初始化完成后就不再修改，只作为只读配置使用，多 goroutine 并发读取没有问题。

真正危险的是：

- 一个 goroutine 读，另一个 goroutine 写
- 多个 goroutine 同时写
- 看起来只是读，但某个后台任务会更新 map

第三种在服务端很常见。

比如：

- 本地缓存定时刷新
- 热配置后台更新
- 连接表动态增删
- 用户状态表随请求变化

代码表面上很多地方只是：

```go
value := cache[key]
```

但只要另一个 goroutine 可能同时写这个 `cache`，它就不再是安全读。

所以判断一个 `map` 能不能裸读，关键不是看当前函数有没有写，而是看：

> 同一时间，整个程序里是否可能有人写它。

## 八、用 Mutex 还是 RWMutex？

最直接的解决方式是加锁。

如果读写都不复杂，可以用 `sync.Mutex`：

```go
type Cache struct {
    mu   sync.Mutex
    data map[string]int
}

func (c *Cache) Get(key string) (int, bool) {
    c.mu.Lock()
    defer c.mu.Unlock()

    v, ok := c.data[key]
    return v, ok
}

func (c *Cache) Set(key string, value int) {
    c.mu.Lock()
    defer c.mu.Unlock()

    c.data[key] = value
}
```

这段代码的核心不是“加锁”这两个字，而是：

> 所有访问同一个 map 的路径，都必须遵守同一把锁。

只给写加锁、读不加锁，仍然不安全。

如果读多写少，可以考虑 `sync.RWMutex`：

```go
type Cache struct {
    mu   sync.RWMutex
    data map[string]int
}

func (c *Cache) Get(key string) (int, bool) {
    c.mu.RLock()
    defer c.mu.RUnlock()

    v, ok := c.data[key]
    return v, ok
}

func (c *Cache) Set(key string, value int) {
    c.mu.Lock()
    defer c.mu.Unlock()

    c.data[key] = value
}
```

`RWMutex` 的意思是：

- 多个读可以并发
- 写必须独占
- 写期间不能读
- 读期间写要等待

它适合读明显多于写的场景。

但如果写很多，或者临界区很复杂，`RWMutex` 不一定比 `Mutex` 更好。

因为读写锁本身也有管理成本。

所以更稳的判断方式是：

> 先保证正确，再根据实际竞争情况决定用 Mutex 还是 RWMutex。

## 九、sync.Map 适合什么场景？

除了自己加锁，Go 还提供了 `sync.Map`。

它是并发安全的，但它不是普通 `map + 锁` 的无脑替代品。

`sync.Map` 更适合这类场景：

- 读非常多，写比较少
- key 相对稳定
- 很多 goroutine 访问同一份缓存
- 可以接受弱类型的 API

比如：

- 全局配置缓存
- 只增不频繁删的对象缓存
- 读远多于写的共享索引

它不太适合：

- 写很多
- 频繁删除
- 需要复杂的复合操作
- 强依赖类型安全

因为 `sync.Map` 的 API 使用的是 `any`：

```go
var m sync.Map

m.Store("alice", 90)

v, ok := m.Load("alice")
if ok {
    score := v.(int)
    _ = score
}
```

类型转换本身会带来额外心智负担。

而且很多逻辑不是单次 `Load` 或 `Store` 就能表达的。

比如：

```text
如果 key 不存在，就初始化一个对象；如果存在，就更新里面某个字段。
```

这种复合操作仍然要小心并发语义。

所以实际开发里，可以先用一个简单原则：

> 常规共享 map 优先用 map + Mutex/RWMutex；只有在读多写少、key 稳定、访问模式简单时，再考虑 sync.Map。

## 十、为什么 map 遍历顺序不稳定？

Go 的 `map` 遍历顺序是不保证的。

比如：

```go
for key, value := range m {
    fmt.Println(key, value)
}
```

你不能假设每次输出顺序一致。

这不是缺陷，而是设计约束。

因为 `map` 的内部布局本来就会受很多因素影响：

- 哈希种子
- 元素数量
- 插入顺序
- 扩容状态
- runtime 实现细节

如果语言承诺遍历顺序稳定，就会限制 runtime 对 `map` 的优化空间。

更重要的是，它会诱导开发者写出依赖隐含顺序的代码。

所以如果你真的需要顺序，就应该显式维护顺序：

```go
keys := make([]string, 0, len(m))
for key := range m {
    keys = append(keys, key)
}

sort.Strings(keys)

for _, key := range keys {
    fmt.Println(key, m[key])
}
```

这段代码把“我要顺序”这件事表达得很清楚。

`map` 负责快速查找，`slice + sort` 负责顺序。

这是更稳定的职责划分。

## 十一、delete 之后内存为什么不一定降？

另一个常见误解是：

> 我已经 delete 了很多 key，为什么进程内存没明显下降？

先看代码：

```go
delete(m, key)
```

`delete` 的作用是从逻辑上移除这个 key/value。

但这不等于：

- map 内部存储马上缩小
- 进程内存马上还给操作系统
- GC 之后 RSS 立刻下降

原因有几层。

首先，`map` 为了避免频繁伸缩，不会因为你删了几个 key 就立刻重建内部结构。

否则在频繁增删的场景下，它会不断分配、搬迁、释放，性能会非常差。

其次，被删除的 value 如果不再被其他地方引用，GC 可以回收它关联的对象。

但 map 自己内部的存储结构不一定马上缩小。

最后，即使 Go runtime 回收了一些堆内存，操作系统层面看到的进程 RSS 也不一定立刻下降。

所以如果一个大 map 经历了大量删除，而你确实希望释放内部结构，常见做法是重建：

```go
newMap := make(map[string]Value, expectedSize)
for key, value := range oldMap {
    if shouldKeep(key, value) {
        newMap[key] = value
    }
}
oldMap = newMap
```

这件事本质上是：

> 用一张新的、更紧凑的 map，替换掉旧的内部结构。

当然，这种操作本身也有成本。

它适合放在明确的维护时机，而不是每次删除后都做。

## 十二、写 Go 代码时应该怎么用 map？

`map` 本身很好用，但它不应该被当作没有成本的全局共享容器。

实际开发里，可以抓住几个原则。

### 1. 能预估大小时，提前给容量

如果你大概知道会放多少元素，可以这样写：

```go
users := make(map[string]User, len(rawUsers))
```

这不保证完全避免扩容，但可以减少不必要的增长成本。

尤其是在热点路径里，频繁创建小 map 再不断扩容，会制造额外分配和 GC 压力。

### 2. 共享 map 必须统一同步方式

如果一个 map 会被多个 goroutine 访问，并且存在写操作，就不要裸用。

要么用锁：

```go
mu.Lock()
m[key] = value
mu.Unlock()
```

要么封装成一个结构体，把访问路径收进去：

```go
type Store struct {
    mu sync.RWMutex
    m  map[string]Value
}
```

不要让同一张 map 在不同地方用不同规则访问。

这种代码短期看方便，长期最容易出隐藏并发问题。

### 3. 不要依赖遍历顺序

只要你写了：

```go
for key := range m {
}
```

就应该默认顺序不可控。

需要稳定输出、稳定序列化、稳定测试结果时，先取 key 排序。

### 4. 大 map 删除后，要关注是否需要重建

如果一个 map 长期持有大量 key，后来又删除了大部分，内存不一定马上明显下降。

这时要根据场景判断：

- 是否只是短期波动
- 是否会继续复用这张 map
- 是否应该定期重建
- 是否应该改成分片或带过期策略的缓存结构

不要只盯着 `delete`，还要看整个生命周期。

## 结语

`map` 的语法很简单：

```go
m[key] = value
value := m[key]
delete(m, key)
```

但它背后的机制并不简单。

它是一套由 runtime 维护的动态哈希结构，会处理哈希定位、冲突、扩容、迁移和内存复用。

这些机制让 `map` 在大多数业务场景里足够快、足够好用。

但也正因为它内部状态会变化，普通 `map` 不能被多个 goroutine 随便并发读写。

所以理解 `map`，不是为了背几个内部字段名，而是为了在写代码时知道：

- 什么时候它只是一个方便的查找表
- 什么时候它已经变成共享状态
- 什么时候它的扩容和内存行为会影响性能
- 什么时候你必须用锁、`sync.Map` 或重新设计数据结构

`slice` 的难点在于它是“数组窗口”。

`map` 的难点在于它是“会变化的哈希结构”。

把这两件事分清楚，很多 Go 代码里的容器问题就不再只是经验判断，而是能回到机制本身去解释。
