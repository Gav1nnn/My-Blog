---
title: "Go 的内存模型是什么：并发代码为什么会看起来没问题"
seoTitle: "Go 的内存模型是什么：并发代码为什么会看起来没问题 | Gavin's Blog"
description: "从后端工程视角理解 Go 内存模型、data race、happens-before、可见性、Mutex、Channel、Once、atomic 和 race detector。"
pubDate: 2026-03-16
tags:
  - Go系列
  - 内存模型
  - 并发
  - Sync
---

## 前言

上一篇讲 `Context`、`Mutex`、`RWMutex` 和 `WaitGroup` 时，我们把 Go 的并发控制拆成了几个问题：

- 什么时候停
- 谁能改共享状态
- 什么时候算完成

但还有一个更底层的问题没有展开：

> 一个 goroutine 写入的数据，另一个 goroutine 什么时候一定能看见？

很多并发 bug 的麻烦就在这里。

代码从单个 goroutine 视角看，顺序非常清楚：

```go
value = 42
done = true
```

直觉上会觉得：

> 既然 `done` 已经是 `true`，那 `value` 肯定已经是 `42`。

但在并发程序里，这个直觉并不可靠。

如果两个 goroutine 之间没有建立同步关系，一个 goroutine 看到 `done == true`，并不意味着它也一定能看到 `value = 42` 这次写入。

这就是 Go 内存模型要回答的问题：

> 在什么条件下，一个 goroutine 对变量的写入，可以保证被另一个 goroutine 观察到？

这一篇就沿着这条主线，梳理数据竞争、happens-before、可见性，以及 `Mutex`、`Channel`、`Once`、`atomic` 这些工具到底提供了什么同步保证。

## 一、为什么需要内存模型？

先看一段很容易让人误判的代码：

```go
var value int
var done bool

go func() {
    value = 42
    done = true
}()

for !done {
}

fmt.Println(value)
```

很多人第一次看会觉得它能打印 `42`。

因为从写代码的顺序看：

```text
先写 value = 42
再写 done = true
看到 done == true
所以 value 应该已经写好了
```

问题在于，这个推理只站在一个顺序执行的视角里。

在并发程序里，另一个 goroutine 能不能观察到这个顺序，需要同步关系来保证。

如果没有同步，编译器、CPU 和 runtime 都有优化空间。

更重要的是，Go 语言本身也不会承诺另一个 goroutine 必须按你想象的方式观察这些写入。

所以这里真正的问题不是：

> 这段代码会不会偶尔慢一点看到？

而是：

> 这段代码没有给出可靠的并发语义。

内存模型存在的原因，就是为了给这种问题一个边界：

- 哪些读写是有保证的
- 哪些同步操作能建立顺序
- 什么情况下程序已经出现数据竞争
- 没有数据竞争时，程序能按什么方式理解

## 二、数据竞争到底是什么？

Go 内存模型里，一个最重要的概念就是 data race。

可以先用工程化的方式理解：

> 两个 goroutine 同时访问同一个变量，至少一个是写，并且它们之间没有同步关系，就发生了数据竞争。

比如：

```go
var count int

go func() {
    count++
}()

go func() {
    count++
}()
```

这里两个 goroutine 都在写 `count`。

它们之间没有锁、没有 channel、没有 atomic，也没有其他同步关系。

这就是数据竞争。

再比如：

```go
var config Config
var ready bool

go func() {
    config = loadConfig()
    ready = true
}()

go func() {
    if ready {
        use(config)
    }
}()
```

这里一个 goroutine 写 `ready` 和 `config`，另一个 goroutine 读它们。

如果没有同步，也同样是不可靠的。

数据竞争不是“小概率读错值”这么简单。

更准确地说：

> 一旦程序存在数据竞争，你就不能再用普通的顺序执行直觉去推理它。

Go 官方内存模型给了一个很重要的方向：程序应该避免数据竞争；没有数据竞争的程序，可以按一种更接近顺序一致的方式理解。

这也是为什么 Go 里经常强调：

> 不要通过侥幸观察结果来证明并发代码是对的。

## 三、happens-before 是什么？

要理解内存模型，绕不开 `happens-before`。

但不需要一上来把它理解成数学定义。

可以先抓住一句话：

> happens-before 描述的是：一个操作的结果，必须对另一个操作可见的顺序关系。

在单个 goroutine 内部，普通语句本身有顺序。

比如：

```go
a = 1
b = 2
```

在同一个 goroutine 里，`a = 1` 排在 `b = 2` 前面。

但跨 goroutine 之后，仅靠源码顺序不够。

需要同步操作把两个 goroutine 的执行关系连起来。

比如：

```text
goroutine A: 写入数据
goroutine A: 发送 channel
goroutine B: 接收 channel
goroutine B: 读取数据
```

这里 channel 发送和接收建立了同步关系。

于是可以推导出：

```text
写入数据 happens-before 读取数据
```

这就是内存模型最有用的地方。

它不是在告诉你 CPU 具体怎么执行每一条指令，而是在告诉你：

> 什么时候你可以安全地说，前面的写入对后面的读取可见。

## 四、Mutex 不只是互斥，也提供可见性

很多人理解 `Mutex` 时，只记住了互斥：

> 同一时刻只能有一个 goroutine 进入临界区。

这当然对。

但从内存模型角度看，锁还有另一层意义：

> 前一次 `Unlock` happens-before 后一次成功的 `Lock` 返回。

也就是说，持锁期间完成的写入，对后续拿到同一把锁的 goroutine 是可见的。

比如：

```go
var mu sync.Mutex
var value int

func write() {
    mu.Lock()
    value = 42
    mu.Unlock()
}

func read() int {
    mu.Lock()
    defer mu.Unlock()

    return value
}
```

这里锁做了两件事：

- 避免多个 goroutine 同时访问 `value`
- 保证写入 `value = 42` 后，后续拿到同一把锁的 goroutine 能看到这个写入

所以锁不是单纯为了“排队”。

它同时提供了顺序和可见性。

这也是为什么访问共享状态时，读写都要遵守同一把锁。

如果写的时候加锁，读的时候不加锁，读操作就没有通过同一个同步关系接住写入结果。

代码仍然是不可靠的。

## 五、Channel 不只是传值，也能传递顺序

前面 Channel 文章里，我们说过：

> channel 不只是一个并发安全队列，它还表达数据交接和 goroutine 协作。

从内存模型角度看，channel 还有一个关键作用：

> channel 发送 happens-before 对应接收完成。

比如：

```go
var value int
ch := make(chan struct{})

go func() {
    value = 42
    ch <- struct{}{}
}()

<-ch
fmt.Println(value)
```

这段代码是可靠的。

因为：

```text
value = 42
  happens-before
ch <- struct{}{}
  synchronized-before
<-ch
  happens-before
fmt.Println(value)
```

不用记这些术语也可以。

工程上可以理解成：

> 接收方收到这个信号时，可以确认发送方在发送之前的写入已经完成并可见。

关闭 channel 也有类似意义。

如果一个 goroutine 在写完共享状态后关闭 channel，另一个 goroutine 从这个 channel 接收到关闭信号，也可以把它当成一种广播式通知。

比如：

```go
var value int
done := make(chan struct{})

go func() {
    value = 42
    close(done)
}()

<-done
fmt.Println(value)
```

这里的 `close(done)` 不只是“关闭资源”。

它表达的是：

> 写入已经完成，等待方可以继续。

这也解释了为什么 channel 经常用来做完成通知。

它传递的不只是数据，也传递了顺序。

## 六、Buffered Channel 的同步关系更容易误判

无缓冲 channel 的交接关系比较直观。

发送和接收必须同时配对。

但有缓冲 channel 更容易让人误判。

比如：

```go
ch := make(chan struct{}, 1)

go func() {
    value = 42
    ch <- struct{}{}
}()

ch <- struct{}{}
fmt.Println(value)
```

这类代码就不能简单套用“发送和接收一定建立我想要的顺序”。

因为缓冲区让发送方可以在没有接收方立刻参与的情况下继续执行。

Go 内存模型对有缓冲 channel 有更精确的规则，但对日常开发来说，可以先抓住这个工程判断：

> 如果你想用 channel 建立明确的先后关系，要确认真正配对的是哪一次发送和哪一次接收。

无缓冲 channel 更像直接交接。

有缓冲 channel 更像带容量的等待区。

它仍然能提供同步保证，但不能把它想象成每一次发送都立刻和某个接收方面对面完成。

这也是为什么用 buffered channel 做信号时，要格外注意容量和收发关系。

## 七、Once 保证的不只是只执行一次

`sync.Once` 常见用法是初始化：

```go
var once sync.Once
var config Config

func GetConfig() Config {
    once.Do(func() {
        config = loadConfig()
    })

    return config
}
```

从 API 行为看，`once.Do` 保证函数只执行一次。

但从内存模型看，它还保证：

> 被执行的函数完成 happens-before 任意一次 `once.Do` 返回。

这意味着，初始化函数里写入的结果，对其他从 `once.Do` 返回的 goroutine 是可见的。

所以 `Once` 不是简单的“防重复调用”。

它也是一个初始化同步机制。

这能避免很多错误的双重检查写法。

比如：

```go
if !initialized {
    config = loadConfig()
    initialized = true
}

return config
```

多 goroutine 下，这种写法既没有互斥，也没有可见性保证。

另一个 goroutine 可能看到 `initialized == true`，却不能可靠地看到完整的 `config`。

如果初始化需要被多个 goroutine 共享，优先用 `sync.Once` 或锁，而不是手写一个布尔变量。

## 八、Atomic 适合简单状态，不适合复杂不变量

`sync/atomic` 提供的是原子操作。

比如：

```go
var count atomic.Int64

count.Add(1)
fmt.Println(count.Load())
```

从内存模型角度看，atomic 操作也是同步操作。

Go 的 atomic 操作表现得像按某个全局顺序依次执行。

这让它适合处理一些简单状态：

- 计数器
- 开关标志
- 最近一次时间戳
- 指针替换

但 atomic 最容易被滥用。

比如你有一组状态：

```go
type State struct {
    ready bool
    data  Data
}
```

如果把 `ready` 改成 atomic，并不自动意味着 `data` 的所有读写都安全。

因为你的真正需求可能不是“安全读写一个 bool”，而是：

> ready 和 data 之间要保持一致。

这种时候锁往往更清楚。

atomic 适合单点状态变化。

锁适合一段需要保持不变量的逻辑。

如果为了避免锁，把多个相关状态拆成一堆 atomic 变量，代码通常会变得更难推理。

## 九、WaitGroup 等待完成，但不是数据保护工具

`WaitGroup` 用来等一组 goroutine 结束。

比如：

```go
var wg sync.WaitGroup
var result int

wg.Add(1)
go func() {
    defer wg.Done()
    result = 42
}()

wg.Wait()
fmt.Println(result)
```

在这个例子里，`Wait` 返回后，goroutine 已经执行完，读取 `result` 是符合预期的。

但要注意边界。

`WaitGroup` 的职责是等待完成，不是保护共享状态。

如果多个 goroutine 同时写同一个变量：

```go
var wg sync.WaitGroup
var result int

for i := 0; i < 10; i++ {
    wg.Add(1)
    go func(i int) {
        defer wg.Done()
        result += i
    }(i)
}

wg.Wait()
fmt.Println(result)
```

这里 `WaitGroup` 只能保证最后等到了所有 goroutine 结束。

它不能让 `result += i` 变成并发安全。

如果中间存在多个 goroutine 同时读写 `result`，仍然需要锁、channel 汇总或 atomic。

所以可以这样理解：

> WaitGroup 解决“任务是否结束”，不解决“任务执行过程中共享数据是否安全”。

## 十、为什么忙等和 sleep 不是同步？

很多不可靠的并发代码，都是试图用观察或时间来代替同步。

比如忙等：

```go
for !done {
}
fmt.Println(value)
```

或者：

```go
time.Sleep(100 * time.Millisecond)
fmt.Println(value)
```

这两种方式都不能建立可靠的 happens-before 关系。

`Sleep` 只能说明当前 goroutine 暂停了一段时间。

它不能说明另一个 goroutine 的写入已经完成，也不能说明写入结果对当前 goroutine 可见。

这类代码的问题是：

> 它把时间当成了同步。

在本地机器上看起来没问题，在压力、调度、CPU、编译优化变化后，都可能暴露问题。

如果你需要等待某件事完成，应该用明确的同步机制：

- channel
- Mutex
- WaitGroup
- Cond
- atomic
- Context + select

不要用 `Sleep` 证明并发代码正确。

## 十一、Race Detector 能帮你看到什么？

Go 提供了内置 race detector。

常见用法是：

```bash
go test -race ./...
```

也可以：

```bash
go run -race main.go
go build -race ./cmd/server
```

它能在程序运行过程中发现数据竞争，并输出冲突访问的位置以及相关 goroutine 的创建栈。

这对排查并发问题很有价值。

但它也有边界。

race detector 只能发现运行时实际走到的竞争路径。

如果测试没有覆盖到某条并发路径，它就看不到那里的问题。

所以它不是形式化证明工具。

更实际的定位是：

> race detector 是 Go 并发代码的安全网，但不是你放弃同步设计的理由。

写共享状态代码时，还是要先想清楚同步关系。

然后再用 `-race` 帮你发现遗漏。

## 十二、实际写 Go 并发代码时怎么判断？

写并发代码时，可以先问几个问题。

### 1. 这个变量会不会跨 goroutine 共享？

如果不会，只在一个 goroutine 内部使用，就不用引入同步。

如果会，就继续问：

> 谁写？谁读？它们之间有没有同步关系？

### 2. 有没有一个明确的 happens-before？

比如：

- 同一把锁的 `Unlock` 到后续 `Lock`
- channel 发送到对应接收
- `close` 到接收关闭信号
- `Once.Do` 的初始化到后续返回
- atomic 操作之间的同步顺序

如果没有，就不要假设另一个 goroutine 能看到你的写入。

### 3. 状态是一点，还是一组不变量？

如果只是一个计数或标志，atomic 可能合适。

如果是多个字段之间要保持一致，用锁通常更清楚。

如果是任务之间传递数据，用 channel 可能更合适。

### 4. 能不能把共享改成传递？

很多时候，与其让多个 goroutine 共享一份可变数据，不如通过 channel 传递所有权。

比如把结果汇总到一个 goroutine 里：

```go
results := make(chan int)

go func() {
    results <- compute()
}()

value := <-results
```

这样共享状态减少了，同步关系也更清晰。

### 5. 有没有用工具检查？

至少在测试和关键路径上跑：

```bash
go test -race ./...
```

它不能证明没有问题，但能帮你尽早发现明显的数据竞争。

## 结语

Go 的内存模型看起来很抽象，但它回答的是一个非常实际的问题：

> 一个 goroutine 写入的数据，另一个 goroutine 什么时候一定能看见？

如果没有同步关系，就不要依赖“我代码里是先写这个再写那个”的直觉。

跨 goroutine 之后，真正有意义的是 happens-before。

它可以由不同的同步机制建立：

- `Mutex` 通过 `Unlock` 和后续 `Lock`
- `Channel` 通过发送、接收和关闭
- `Once` 通过初始化函数完成和 `Do` 返回
- `atomic` 通过原子操作的同步顺序
- `WaitGroup` 用来等待任务完成，但不替代共享数据保护

这篇也把前面几篇并发文章收束到一起：

- `GMP` 解释 goroutine 如何被调度
- `Channel` 解释 goroutine 如何通信
- `Select` 解释 goroutine 如何等待多个事件
- `Context/Sync` 解释生命周期、共享状态和任务完成
- 内存模型解释这些同步手段到底保证了什么

所以写 Go 并发代码时，不要只问“有没有并发跑起来”。

更应该问：

> 这些 goroutine 之间，数据的可见性和顺序关系到底靠什么保证？

这个问题问清楚了，很多“看起来没问题”的并发代码，才会真正变得可靠。

## 参考

- [The Go Memory Model](https://go.dev/ref/mem)
- [Data Race Detector](https://go.dev/doc/articles/race_detector)
