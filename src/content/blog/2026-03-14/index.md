---
title: "Go 并发控制到底在控制什么：Context、Mutex、RWMutex 与 WaitGroup"
seoTitle: "Go 并发控制到底在控制什么：Context、Mutex、RWMutex 与 WaitGroup | Gavin's Blog"
description: "从后端工程视角理解 Go 并发控制中的生命周期、共享状态和任务完成，梳理 Context、Mutex、RWMutex、WaitGroup、Once 与 atomic 的使用边界。"
pubDate: 2026-03-14
tags:
  - Go系列
  - Context
  - Sync
  - 并发
---

## 前言

上一篇讲 `select` 时，最后落到了一个很常见的结构：

```go
select {
case value := <-ch:
    handle(value)
case <-ctx.Done():
    return
}
```

这段代码看起来只是多等了一个 `ctx.Done()`。

但它背后其实已经进入了 Go 并发里更大的一个问题：

> goroutine 跑起来之后，谁来决定它什么时候停、怎么访问共享状态、什么时候算真正完成？

很多并发问题不是出在“不会启动 goroutine”。

真正麻烦的是后半段：

- 请求已经取消了，后台 goroutine 还在跑
- 多个 goroutine 同时修改一份 `map`
- 主流程提前返回，子任务还没结束
- 某个初始化逻辑被执行了多次
- 想用原子操作优化，最后把并发语义写得更难判断

这些问题表面上不一样，背后都属于并发控制。

并发控制不是只有“加锁”一件事。

更准确地说，它至少在回答三个问题：

> 什么时候停？谁能改共享状态？什么时候算完成？

这一篇就沿着这条主线，把 `Context`、`Mutex`、`RWMutex`、`WaitGroup` 以及 `Once`、`sync.Map`、`atomic` 的边界串起来。

## 一、并发控制不只是加锁

很多人第一次接触并发控制时，会先想到锁。

这很正常。

因为只要多个 goroutine 访问同一份可变数据，锁就是最直接的保护方式。

比如：

```go
type Store struct {
    mu   sync.Mutex
    data map[string]int
}
```

但真实服务里的并发问题，不只是一份数据怎么加锁。

还有很多问题是锁解决不了的：

- 一个请求超时后，相关 goroutine 怎么退出？
- 调用链上游取消了，下游数据库查询要不要继续？
- 多个并发任务启动后，主流程怎么等待它们全部完成？
- 某个后台任务失败了，其他任务要不要一起停？
- 初始化逻辑要怎么保证只执行一次？

这些问题对应的是不同的控制维度。

可以先用一张简单的表理解：

| 问题 | 典型工具 | 控制对象 |
| --- | --- | --- |
| 什么时候停 | `context.Context` | 生命周期 |
| 谁能访问共享状态 | `Mutex` / `RWMutex` | 临界区 |
| 什么时候全部完成 | `WaitGroup` | 任务完成 |
| 只执行一次 | `sync.Once` | 初始化动作 |
| 简单变量并发更新 | `atomic` | 单个值 |

所以这篇不把这些工具当成 API 清单，而是看它们各自控制了什么。

## 二、Context：控制一条调用链什么时候应该停止

`Context` 最核心的作用，是在调用链里传递取消信号、超时时间和请求级数据。

它不是为了让函数参数变得统一，也不是为了随便塞值。

真正重要的是：

> 当上游已经不需要结果时，下游应该有机会知道这件事，并尽快停止无意义的工作。

比如一个 HTTP 请求进来后，后面可能会调用：

```text
handler -> service -> repository -> database
```

如果客户端断开连接，或者请求超时，继续执行数据库查询、RPC 调用、后台计算就可能变成浪费。

这时需要一个信号沿着调用链往下传。

这就是 `Context` 的位置。

它的核心接口可以简化理解成：

```go
type Context interface {
    Deadline() (deadline time.Time, ok bool)
    Done() <-chan struct{}
    Err() error
    Value(key any) any
}
```

其中最关键的是 `Done()`。

它返回一个只读 channel。

当 context 被取消或超时时，这个 channel 会被关闭。

所以它天然可以和 `select` 配合：

```go
select {
case result := <-resultCh:
    return result, nil
case <-ctx.Done():
    return zero, ctx.Err()
}
```

这段代码表达得很清楚：

- 正常结果先回来，就返回结果
- context 先取消，就停止等待并返回取消原因

`select` 负责多路等待。

`Context` 负责告诉这条链路：

> 不用再等了。

## 三、Context 为什么是树状传播？

`Context` 不是一个孤立信号。

它更像一棵树。

从一个父 context 可以派生出子 context：

```go
ctx, cancel := context.WithCancel(context.Background())
child, childCancel := context.WithTimeout(ctx, 2*time.Second)
```

父 context 取消时，子 context 也会被取消。

可以简化理解成：

```text
request ctx
  ├─ db query ctx
  ├─ rpc call ctx
  └─ worker ctx
```

这和请求链路非常贴合。

一个请求下面可能有多个子任务。

当请求整体已经结束，下面所有派生出来的工作都应该知道。

这也是为什么 `Context` 通常作为函数的第一个参数传递：

```go
func GetUser(ctx context.Context, id string) (User, error) {
    return repo.FindUser(ctx, id)
}
```

这种写法的含义是：

> 这个函数属于某条调用链，它应该尊重这条调用链的生命周期。

不建议把 `Context` 存进结构体里，也是同一个原因。

`Context` 表达的是一次调用、一次请求、一次任务的生命周期。

它不应该变成某个长期对象的隐藏状态。

## 四、WithCancel、WithTimeout 和 cancel 到底在控制什么？

常见创建方式有几类：

```go
ctx := context.Background()
ctx := context.TODO()

ctx, cancel := context.WithCancel(parent)
ctx, cancel := context.WithTimeout(parent, 2*time.Second)
ctx, cancel := context.WithDeadline(parent, deadline)
```

`Background` 通常作为根 context。

比如服务启动入口、测试入口、主流程入口。

`TODO` 更像占位符。

它表达的是：

> 这里暂时还不知道应该传什么 context。

真正涉及控制的是后面三类。

`WithCancel` 让你可以手动取消：

```go
ctx, cancel := context.WithCancel(parent)
defer cancel()
```

`WithTimeout` 和 `WithDeadline` 则加入时间限制。

比如：

```go
ctx, cancel := context.WithTimeout(parent, 2*time.Second)
defer cancel()
```

这里的 `cancel` 不只是“提前取消”。

即使超时时间到了会自动取消，也仍然应该调用 `cancel`。

原因是它可以让 context 及时释放关联的资源，避免 timer 和子 context 关系保留得更久。

所以可以先记住一个原则：

> 谁创建了带 cancel 的 context，谁就应该负责调用 cancel。

`defer cancel()` 是很多场景下最稳的默认写法。

## 五、Context 的 Value 为什么要慎用？

`Context` 里有一个 `Value` 方法：

```go
Value(key any) any
```

它可以沿调用链传递请求级数据。

比如：

- trace id
- request id
- auth token
- 用户身份信息

但它不适合用来传普通业务参数。

比如下面这种就不太好：

```go
ctx = context.WithValue(ctx, "pageSize", 20)
ctx = context.WithValue(ctx, "sortType", "desc")
```

这些值更适合作为显式参数传递。

`Context` 里的值有几个问题：

- 类型不够直观
- key 冲突需要额外设计
- 调用方不容易知道函数依赖了哪些值
- 过度使用会让数据流变隐式

所以 `Value` 更适合放请求元信息，而不是业务入参。

可以简单判断：

> 如果没有这个值，函数的业务语义就不完整，那它更应该是函数参数，而不是 context value。

## 六、Mutex：给共享状态划出临界区

`Context` 解决的是生命周期。

但如果多个 goroutine 真的要共享一份可变状态，还是要回到同步问题。

比如：

```go
cache := map[string]User{}
```

如果多个 goroutine 同时读写这张 `map`，就会回到前面 Map 文章里讲过的问题：

> 普通 map 不是并发安全的。

这时 `Mutex` 的作用就是划出临界区：

```go
type UserCache struct {
    mu    sync.Mutex
    users map[string]User
}

func (c *UserCache) Set(id string, user User) {
    c.mu.Lock()
    defer c.mu.Unlock()

    c.users[id] = user
}

func (c *UserCache) Get(id string) (User, bool) {
    c.mu.Lock()
    defer c.mu.Unlock()

    user, ok := c.users[id]
    return user, ok
}
```

这里最关键的不是 `Lock` 和 `Unlock` 这两个 API，而是：

> 所有访问同一份共享状态的路径，都必须遵守同一套同步规则。

只给写加锁，读不加锁，仍然不安全。

一个地方用锁，另一个地方绕过锁直接访问，也不安全。

锁控制的是访问边界。

它让某一段代码在同一时刻只能被一个 goroutine 执行，从而保护这段代码里的共享状态。

## 七、Mutex 底层为什么不只是“睡觉等锁”？

从使用者角度看，`Mutex` 很简单：

```go
mu.Lock()
defer mu.Unlock()
```

但它底层并不是抢不到锁就立刻休眠。

可以粗略理解成几个阶段：

```text
尝试通过原子操作抢锁
  ↓
短时间自旋等待
  ↓
竞争严重时进入阻塞队列
  ↓
被唤醒后继续竞争
```

为什么需要自旋？

因为有些锁持有时间非常短。

如果每次抢不到锁都立刻挂起 goroutine，再等别人唤醒，就会引入额外调度成本。

短暂自旋可以避免一些不必要的阻塞和唤醒。

但自旋不是免费的。

它会消耗 CPU。

所以当竞争激烈或者等待时间变长时，runtime 还是会让 goroutine 进入阻塞等待。

对业务代码来说，不需要记住所有内部状态位。

真正要理解的是：

> 锁不是没有成本的。临界区越大、竞争越激烈，调度和等待成本就越明显。

所以写锁相关代码时，要尽量让临界区只包住真正需要保护的共享状态。

不要在持锁期间做慢操作，比如网络请求、磁盘 IO、复杂计算。

## 八、RWMutex：读多写少时的共享边界

`Mutex` 是完全互斥。

同一时刻只有一个 goroutine 能进入临界区。

但有些场景里，大部分操作只是读。

比如：

- 读取配置
- 查询本地缓存
- 读取路由表
- 访问很少更新的索引

这时可以考虑 `RWMutex`：

```go
type ConfigStore struct {
    mu     sync.RWMutex
    config map[string]string
}

func (s *ConfigStore) Get(key string) (string, bool) {
    s.mu.RLock()
    defer s.mu.RUnlock()

    value, ok := s.config[key]
    return value, ok
}

func (s *ConfigStore) Set(key string, value string) {
    s.mu.Lock()
    defer s.mu.Unlock()

    s.config[key] = value
}
```

`RWMutex` 的语义是：

- 多个读锁可以同时持有
- 写锁必须独占
- 写锁持有期间不能读也不能写
- 读锁存在时，写锁需要等待

它适合读多写少。

但它不是比 `Mutex` 永远更高级。

如果写操作很多，或者临界区非常短，`RWMutex` 的管理成本可能抵消它带来的收益。

还有一个容易误解的点是写锁饥饿。

如果源源不断有新的读锁进来，写锁会不会一直等不到？

Go 的 `RWMutex` 会在有写锁等待时阻止后续新的读锁无限插队。

也就是说，它不会让写锁在持续新读请求下无限饥饿。

所以选择 `RWMutex` 时，不要只看“有读有写”，而要看读写比例和竞争模式。

## 九、WaitGroup：等待一组 goroutine 真的结束

`WaitGroup` 控制的是任务完成。

它不负责取消，也不负责保护共享状态。

它只回答一个问题：

> 我启动的一组 goroutine，什么时候全部结束？

典型用法是：

```go
var wg sync.WaitGroup

wg.Add(1)
go func() {
    defer wg.Done()
    doWork()
}()

wg.Wait()
```

可以理解成一个计数器：

- `Add` 增加要等待的任务数量
- `Done` 表示一个任务完成
- `Wait` 阻塞直到计数器归零

这类场景在服务端很常见：

```go
var wg sync.WaitGroup
errCh := make(chan error, 3)

wg.Add(3)

go func() {
    defer wg.Done()
    errCh <- getUser()
}()

go func() {
    defer wg.Done()
    errCh <- getOrders()
}()

go func() {
    defer wg.Done()
    errCh <- getBalance()
}()

wg.Wait()
close(errCh)

for err := range errCh {
    if err != nil {
        return err
    }
}
```

这里 `WaitGroup` 只负责等三个 goroutine 都结束。

错误收集靠 `errCh`。

如果要提前取消其他任务，还需要 `Context`。

所以不要把 `WaitGroup` 误解成完整的任务管理器。

它只是等待工具。

## 十、Context 和 WaitGroup 为什么经常一起出现？

很多并发任务既需要取消，也需要等待收尾。

这时 `Context` 和 `WaitGroup` 会一起出现。

比如一个后台 worker 组：

```go
func runWorkers(ctx context.Context, jobs <-chan Job, workers int) {
    var wg sync.WaitGroup

    wg.Add(workers)
    for i := 0; i < workers; i++ {
        go func() {
            defer wg.Done()

            for {
                select {
                case job, ok := <-jobs:
                    if !ok {
                        return
                    }
                    handle(job)

                case <-ctx.Done():
                    return
                }
            }
        }()
    }

    wg.Wait()
}
```

这段代码里，两个工具的职责是分开的：

- `Context`：通知 goroutine 应该退出
- `WaitGroup`：等待 goroutine 已经退出

这件事很重要。

只调用 `cancel()`，不代表所有 goroutine 已经结束。

它只是发出了退出信号。

goroutine 还需要运行到 `select` 的退出分支，然后执行 `defer wg.Done()`。

所以完整的收尾经常是两步：

```text
通知停止
  ↓
等待完成
```

这也是很多服务优雅关闭逻辑的基础。

## 十一、Once：控制某段逻辑只执行一次

`sync.Once` 控制的是“只执行一次”。

典型场景是初始化：

```go
var once sync.Once
var config Config

func LoadConfig() Config {
    once.Do(func() {
        config = readConfig()
    })

    return config
}
```

它解决的是并发初始化问题。

如果多个 goroutine 同时调用 `LoadConfig`，只有一个 goroutine 会真正执行 `readConfig`。

其他 goroutine 会等待或复用这次执行结果。

需要注意的是，如果 `Do` 里的函数发生 `panic`，这次调用也会被认为已经执行过。

后续再调用 `Do`，不会重新执行这段函数。

所以 `Once` 适合初始化那些要么成功、要么失败就应该暴露问题的逻辑。

如果你希望失败后还能重试，就不能简单用 `Once` 包住全部逻辑。

## 十二、sync.Map 和 atomic 适合什么边界？

`sync.Map` 前面 Map 文章已经提过。

这里可以把它放回并发控制的视角里看。

它适合的是比较特殊的共享 map 场景：

- 读多写少
- key 相对稳定
- 访问模式简单
- 可以接受 `any` 带来的类型转换

它不适合替代所有 `map + Mutex`。

如果需要复杂复合操作，比如：

```text
先读一个对象
再检查字段
再更新多个值
```

那仍然需要额外同步设计。

`atomic` 也类似。

它适合简单变量的并发更新，比如计数、标志位、指针替换。

比如：

```go
var count atomic.Int64

count.Add(1)
```

但它不适合复杂临界区。

如果一次操作涉及多个变量之间的一致性，锁通常更清楚。

可以先用一个简单原则判断：

> atomic 适合单点状态变化，锁适合一段需要保持一致性的逻辑。

不要因为原子操作看起来更快，就把复杂业务状态拆成一堆难以推理的 atomic 变量。

可读性和正确性通常比这点性能差异更重要。

## 十三、实际写并发代码时怎么选？

可以把问题拆成几个判断。

### 1. 是生命周期问题吗？

如果你要表达：

- 请求取消
- 超时退出
- 服务关闭
- 上游不再需要结果

优先考虑 `Context`。

再通过 `select` 把 `ctx.Done()` 接进可能阻塞的操作。

### 2. 是共享状态问题吗？

如果多个 goroutine 需要访问同一份可变数据：

- `map`
- 结构体字段
- 本地缓存
- 连接状态

优先考虑 `Mutex` 或 `RWMutex`。

读多写少才考虑 `RWMutex`。

不要裸用普通 `map` 并发读写。

### 3. 是等待一组任务完成吗？

如果你只是要等多个 goroutine 都结束，使用 `WaitGroup`。

如果还要取消它们，配合 `Context`。

如果还要收集错误，额外设计错误通道或使用更高级的任务组封装。

### 4. 是初始化一次吗？

用 `sync.Once`。

但要注意失败和 `panic` 的语义。

如果需要失败重试，单纯 `Once` 可能不合适。

### 5. 是简单变量更新吗？

可以考虑 `atomic`。

但只在状态足够简单、语义足够清楚时使用。

一旦逻辑跨越多个字段，优先回到锁。

## 结语

Go 的并发工具看起来很多：

- `Context`
- `Mutex`
- `RWMutex`
- `WaitGroup`
- `Once`
- `sync.Map`
- `atomic`

但如果只背 API，很容易越用越乱。

更稳的方式是先看它们分别控制什么。

`Context` 控制生命周期。

`Mutex` 和 `RWMutex` 控制共享状态的访问边界。

`WaitGroup` 控制一组任务的完成时机。

`Once` 控制某段逻辑只执行一次。

`atomic` 控制简单变量的并发更新。

把这些边界分清楚之后，前面几篇 Go 并发文章就能串起来：

- `GMP` 解释 goroutine 如何被调度
- `Channel` 解释 goroutine 如何通信
- `Select` 解释 goroutine 如何等待多条通信路径
- 这一篇解释 goroutine 如何被取消、同步和收尾

所以并发控制的核心，不是把所有工具都用上。

而是在写每一段并发代码时，先问清楚：

> 我现在到底是在控制生命周期、共享状态，还是任务完成？

这个问题问清楚了，工具选择通常也就清楚了。
