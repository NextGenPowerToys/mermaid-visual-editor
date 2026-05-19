# Mermaid NG — All Supported Diagrams

A single-file gallery of every diagram family Mermaid NG renders. Open it
in the extension (right-click → **Mermaid NG: Open Mermaid Diagrams from
File**) — each block below becomes its own sheet in the multi-sheet picker.

## 1. Flowchart

```mermaid
flowchart TD
    Start([Start]) --> Auth{Authenticated?}
    Auth -- yes --> Home[Home dashboard]
    Auth -- no  --> Login[Login page]
    Login --> Auth
    Home --> Profile[Profile]
    Home --> Settings[Settings]
    Settings --> Logout([Logout])
```

## 2. Sequence diagram

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant W as Web app
    participant A as Auth service
    participant D as Database

    U->>W: Submit credentials
    W->>A: POST /login
    A->>D: SELECT user WHERE email=?
    D-->>A: row
    A-->>W: JWT token
    W-->>U: 200 OK + cookie
```

## 3. Class diagram

```mermaid
classDiagram
    class Animal {
      +String name
      +int age
      +speak() void
    }
    class Dog {
      +String breed
      +bark() void
    }
    class Cat {
      +bool indoor
      +purr() void
    }
    Animal <|-- Dog
    Animal <|-- Cat
```

## 4. State diagram

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Loading : fetch()
    Loading --> Success : 200
    Loading --> Error : 4xx / 5xx
    Success --> Idle : reset
    Error --> Idle : retry
    Error --> [*] : give up
```

## 5. Entity-relationship diagram

```mermaid
erDiagram
    CUSTOMER ||--o{ ORDER : places
    ORDER ||--|{ LINE_ITEM : contains
    PRODUCT ||--o{ LINE_ITEM : "ordered as"
    CUSTOMER {
      string id PK
      string email
      string name
    }
    ORDER {
      string id PK
      string customerId FK
      datetime placedAt
    }
    LINE_ITEM {
      string orderId FK
      string productId FK
      int quantity
    }
    PRODUCT {
      string id PK
      string sku
      decimal price
    }
```

## 6. Gantt chart

```mermaid
gantt
    title Project plan
    dateFormat  YYYY-MM-DD
    axisFormat  %b %d

    section Design
    Wireframes        :done,    des1, 2026-05-01, 5d
    Visual design     :active,  des2, after des1, 7d

    section Build
    API scaffolding   :         api1, after des2, 10d
    Front-end shell   :         fe1,  after des2, 8d
    Integration       :         int1, after api1, 5d

    section Ship
    QA pass           :         qa1,  after int1, 4d
    Release           :crit,    rel1, after qa1, 1d
```

## 7. Pie chart

```mermaid
pie title Where the day goes
    "Meetings"     : 35
    "Deep work"    : 25
    "Code review"  : 15
    "Email / chat" : 15
    "Breaks"       : 10
```

## 8. User journey

```mermaid
journey
    title New-user onboarding
    section Sign up
      Visit landing page  : 5: User
      Click "Get started" : 4: User
      Create account      : 3: User, Auth
    section First use
      Verify email        : 2: User
      Tutorial            : 4: User, App
      Invite teammate     : 3: User, App
```

## 9. Mindmap

```mermaid
mindmap
  root((Mermaid NG))
    Diagrams
      Flowchart
      Sequence
      Class
      State
      ER
    Features
      WYSIWYG
      Multi-sheet
      Drag & drop
      Offline
    Output
      SVG
      PNG
      Source round-trip
```

## 10. Gitgraph

```mermaid
gitGraph
    commit id: "init"
    commit id: "add readme"
    branch feature
    checkout feature
    commit id: "scaffold"
    commit id: "ui"
    checkout main
    merge feature
    commit id: "release 1.0"
    branch hotfix
    checkout hotfix
    commit id: "patch"
    checkout main
    merge hotfix
```

## 11. Timeline

```mermaid
timeline
    title Mermaid NG release history
    2026-05-17 (1.0.0) : First public release
                       : 12+ diagram families
                       : Multi-sheet editor
    2026-05-17 (1.1.0) : Azure DevOps Wiki containers
                       : Landing page + screenshots
    2026-05-17 (2.0.0) : Mermaid 11.15.0
                       : Drag / label / picker fixes
    2026-05-19 (2.1.0) : Connector toggles
                       : Diagram-type auto-detect
```

## 12. Quadrant chart

```mermaid
quadrantChart
    title Reach vs. effort
    x-axis Low effort --> High effort
    y-axis Low reach --> High reach
    quadrant-1 Big bets
    quadrant-2 Quick wins
    quadrant-3 Don't bother
    quadrant-4 Time sinks
    "Landing page redesign": [0.7, 0.8]
    "Spelling fixes":        [0.1, 0.2]
    "Onboarding tour":       [0.3, 0.7]
    "Internal tool":         [0.6, 0.3]
    "Animated logo":         [0.5, 0.1]
```
