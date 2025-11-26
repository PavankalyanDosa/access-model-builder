import { logger } from '@sailpoint/connector-sdk'

// Simplified types matching ISC API structure
export interface RoleCriteriaKey {
    type: 'IDENTITY' | 'ACCOUNT' | 'ENTITLEMENT'
    property: string
    sourceId?: string
}

export interface RoleCriteriaLevel2 {
    operation: 'EQUALS' | 'NOT_EQUALS' | 'CONTAINS' | 'STARTS_WITH' | 'ENDS_WITH'
    key?: RoleCriteriaKey
    stringValue?: string
    children?: RoleCriteriaLevel2[]
}

export interface RoleCriteriaLevel1 {
    operation: 'AND' | 'OR' | 'EQUALS' | 'NOT_EQUALS' | 'CONTAINS' | 'STARTS_WITH' | 'ENDS_WITH'
    key?: RoleCriteriaKey
    stringValue?: string
    children?: RoleCriteriaLevel2[]
}

export interface RoleMembershipSelector {
    type: 'STANDARD'
    criteria?: RoleCriteriaLevel1
}

export interface Source {
    id: string
    name: string
}

// String Iterator
const END_OF_STRING = '\0'

class StringIterator {
    private currentIndex = 0

    constructor(private readonly str: string) {}

    public advance(): string {
        this.currentIndex++
        if (this.currentIndex >= this.str.length) {
            return END_OF_STRING
        }
        return this.current
    }

    public skipSpace() {
        while (/\s/.test(this.current)) {
            const tmp = this.advance()
            if (END_OF_STRING === tmp) {
                throw new Error('No token found')
            }
        }
    }

    public readToken() {
        this.skipSpace()
        if (this.isQuote(this.current)) {
            this.advance() // skipping quote
            const token = this.moveTo(/^["']$/)
            this.advance() // skipping quote
            return token
        } else {
            return this.moveTo(/[ \t.]/, false)
        }
    }

    public moveTo(char: string | RegExp, required = true): string {
        let current = this.current
        let result = ''
        const regexp = typeof char === 'string' ? new RegExp(char) : char
        while (!regexp.test(current) && END_OF_STRING !== current) {
            result += current
            current = this.advance()
            if (required && current === END_OF_STRING) {
                throw new Error(`[${char}] not found`)
            }
        }
        return result
    }

    private isQuote(char: string): boolean {
        return /^["']$/.test(char)
    }

    get current() {
        if (this.currentIndex > this.str.length) {
            throw new Error('End of string reached')
        }
        return this.str[this.currentIndex]
    }
}

// Types and Expression Classes
type LogicalOperation = 'AND' | 'OR'
type ComparisonOperation = 'eq' | 'ne' | 'co' | 'sw' | 'ew'

function isLogicalOperation(input: string): boolean {
    return /^(and|or)$/i.test(input)
}

function isComparisonOperation(input: string): boolean {
    return /^(eq|ne|co|sw|ew)$/i.test(input)
}

interface Expression {
    accept<T>(v: Visitor<T>, arg: T): void | Promise<void>
}

interface Visitor<T> {
    visitComparisonOperator(val: ComparisonOperator, arg: T): void | Promise<void>
    visitLogicalOperator(val: LogicalOperator, arg: T): void | Promise<void>
    visitAttribute(val: Attribute, arg: T): void | Promise<void>
    visitLiteral(val: Literal, arg: T): void | Promise<void>
}

class Attribute implements Expression {
    sourceName?: string
    property?: string
    type?: 'IDENTITY' | 'ACCOUNT' | 'ENTITLEMENT'

    public static fromIdentityAttribute(identityAttribute: string): Attribute {
        const attr = new Attribute()
        attr.type = 'IDENTITY'
        attr.property = identityAttribute
        return attr
    }

    public static fromSourceBased(
        sourceName: string,
        type: 'ACCOUNT' | 'ENTITLEMENT',
        property: string
    ): Attribute {
        const attr = new Attribute()
        attr.type = type
        attr.property = property
        attr.sourceName = sourceName
        return attr
    }

    public async accept<T>(v: Visitor<T>, arg: T): Promise<void> {
        await v.visitAttribute(this, arg)
    }
}

class Literal implements Expression {
    constructor(public readonly value: string) {}

    public async accept<T>(v: Visitor<T>, arg: T): Promise<void> {
        await v.visitLiteral(this, arg)
    }
}

class LogicalOperator implements Expression {
    constructor(public readonly operation: LogicalOperation, public readonly children: Expression[]) {}

    public async accept<T>(v: Visitor<T>, arg: T) {
        await v.visitLogicalOperator(this, arg)
    }
}

class ComparisonOperator implements Expression {
    constructor(
        public readonly operation: ComparisonOperation,
        public readonly attribute: Attribute,
        public readonly value: Literal
    ) {}

    public async accept<T>(v: Visitor<T>, arg: T) {
        await v.visitComparisonOperator(this, arg)
    }
}

// Parser
class Parser {
    public parse(str: string): Expression {
        const stringIterator = new StringIterator(str.trim())
        let current = stringIterator.current
        const children: Expression[] = []
        let operator: LogicalOperation | undefined

        while (current !== END_OF_STRING) {
            if (current === '(') {
                stringIterator.advance() // skip '('
                const expStr = stringIterator.moveTo('\\)')
                children.push(this.parse(expStr.trim()))
            } else if (!/\s/.test(current)) {
                const token = stringIterator.readToken()

                if (isLogicalOperation(token)) {
                    const currentOperator = token.toLowerCase() === 'and' ? 'AND' : 'OR'
                    if (operator !== undefined && operator !== currentOperator) {
                        throw new Error('All operators should be either "and" or "or"')
                    }
                    operator = currentOperator
                } else if (token.toLowerCase() === 'identity') {
                    children.push(this.parseIdentityCriteria(stringIterator))
                } else {
                    children.push(this.parseSourceBasedCriteria(stringIterator, token))
                }
            }
            current = stringIterator.advance()
        }

        if (children.length === 0) {
            throw new Error('No valid expression found')
        }

        if (children.length === 1) {
            return children[0]
        }

        if (operator === undefined) {
            throw new Error('No valid expression found')
        }

        return new LogicalOperator(operator, children)
    }

    private parseSourceBasedCriteria(stringIterator: StringIterator, sourceName: string): Expression {
        this.checkDot(stringIterator)

        const what = stringIterator.readToken()
        let type: 'ACCOUNT' | 'ENTITLEMENT'
        if ('attribute' === what?.toLowerCase()) {
            type = 'ACCOUNT'
        } else if ('entitlement' === what?.toLowerCase()) {
            type = 'ENTITLEMENT'
        } else {
            throw new Error('Was expecting either attribute or entitlement')
        }

        this.checkDot(stringIterator)
        const attributeName = stringIterator.readToken()

        const op = this.parseComparisonOperation(stringIterator)
        const value = this.parseLiteral(stringIterator)

        return new ComparisonOperator(op, Attribute.fromSourceBased(sourceName, type, attributeName), value)
    }

    private checkDot(stringIterator: StringIterator) {
        const tmpChar = stringIterator.current
        if ('.' !== tmpChar) {
            throw new Error(`Invalid character ${tmpChar}. Expecting '.'`)
        }
        stringIterator.advance() // skip '.'
    }

    private parseIdentityCriteria(stringIterator: StringIterator): Expression {
        this.checkDot(stringIterator)

        const identityAttribute = stringIterator.readToken()
        const op = this.parseComparisonOperation(stringIterator)
        const value = this.parseLiteral(stringIterator)
        return new ComparisonOperator(op, Attribute.fromIdentityAttribute(identityAttribute), value)
    }

    private parseComparisonOperation(stringIterator: StringIterator): ComparisonOperation {
        const opStr = stringIterator.readToken().toLowerCase()
        if (!isComparisonOperation(opStr)) {
            throw new Error('Invalid operator :' + opStr)
        }
        return opStr as ComparisonOperation
    }

    private parseLiteral(stringIterator: StringIterator): Literal {
        const value = stringIterator.readToken()
        return new Literal(value)
    }
}

// Converter
function comparisonOperationMapper(op: ComparisonOperation): RoleCriteriaLevel1['operation'] {
    switch (op) {
        case 'eq':
            return 'EQUALS'
        case 'ne':
            return 'NOT_EQUALS'
        case 'co':
            return 'CONTAINS'
        case 'sw':
            return 'STARTS_WITH'
        case 'ew':
            return 'ENDS_WITH'
        default:
            throw new Error('Invalid operation')
    }
}

class RoleMembershipSelectorConverter implements Visitor<RoleCriteriaLevel1> {
    root: RoleCriteriaLevel1 | undefined = undefined

    constructor(private readonly sources: Source[]) {}

    async visitExpression(val: Expression, arg: RoleCriteriaLevel1): Promise<void> {
        await val.accept(this, arg)

        if (this.root?.children === undefined || this.root?.children?.length === 0) {
            this.root = {
                operation: 'OR',
                children: [this.root as RoleCriteriaLevel2],
            }
        } else if (this.root.children?.every((x) => x.children === undefined || x.children?.length === 0)) {
            this.root = {
                operation: this.root.operation === 'AND' ? 'OR' : 'AND',
                children: [this.root as RoleCriteriaLevel2],
            }
        }
    }

    async visitAttribute(val: Attribute, arg: RoleCriteriaLevel1): Promise<void> {
        const keyType = val.type!
        const property = `attribute.${val.property}`
        let sourceId: string | undefined

        if (keyType !== 'IDENTITY') {
            const source = this.sources.find((x) => x.name === val.sourceName)
            if (source) {
                sourceId = source.id
            } else {
                logger.warn(`Could not find source "${val.sourceName}" in provided sources list`)
            }
        }

        const key: RoleCriteriaKey = {
            type: keyType,
            property,
            sourceId,
        }
        arg.key = key
    }

    visitLiteral(val: Literal, arg: RoleCriteriaLevel1): void {
        arg.stringValue = val.value
    }

    async visitComparisonOperator(val: ComparisonOperator, arg: RoleCriteriaLevel1): Promise<void> {
        const roleCriteriaValue: RoleCriteriaLevel1 = {
            operation: comparisonOperationMapper(val.operation),
        }

        await val.value.accept(this, roleCriteriaValue)
        await val.attribute.accept(this, roleCriteriaValue)

        if (arg !== undefined) {
            arg.children?.push(roleCriteriaValue as RoleCriteriaLevel2)
        } else {
            this.root = roleCriteriaValue
        }
    }

    async visitLogicalOperator(val: LogicalOperator, arg: RoleCriteriaLevel1): Promise<void> {
        const roleCriteriaValue: RoleCriteriaLevel1 = {
            operation: val.operation,
            children: [],
        }
        for (const x of val.children) {
            await x.accept(this, roleCriteriaValue)
        }

        if (arg !== undefined) {
            arg.children?.push(roleCriteriaValue as RoleCriteriaLevel2)
        } else {
            this.root = roleCriteriaValue
        }
    }
}

// Main function
export const stringToMembership = async (str: string, sources: Source[]): Promise<RoleMembershipSelector> => {
    const parser = new Parser()
    const expression = parser.parse(str)
    const converter = new RoleMembershipSelectorConverter(sources)
    await converter.visitExpression(expression, undefined as unknown as RoleCriteriaLevel1)

    const membership: RoleMembershipSelector = {
        type: 'STANDARD',
        criteria: converter.root,
    }

    return membership
}
