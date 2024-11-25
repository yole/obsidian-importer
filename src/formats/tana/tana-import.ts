import { TanaDatabase, TanaDoc } from './models/tana-json';

const inlineRefRegex = /<span data-inlineref-node="(.+)"><\/span>/g;
const boldRegex = /<b>(.*?)<\/b>/g;
const italicRegex = /<i>(.*?)<\/i>/g;

export class TanaGraphImporter {
	public result: Map<string, string> = new Map();
	private tanaDatabase: TanaDatabase;
	private nodes: Map<string, TanaDoc>;
	private convertedNodes: Set<string> = new Set();

	public importTanaGraph(data: string) {
		this.tanaDatabase = JSON.parse(data) as TanaDatabase;
		this.nodes = new Map();
		this.tanaDatabase.docs.forEach(n => this.nodes.set(n.id, n));

		const rootNode = this.tanaDatabase.docs.find(n => n.props.name && n.props.name.startsWith('Root node for'));
		if (!rootNode) {
			console.log('Root node not found');
			return;
		}
		this.convertedNodes.add(rootNode.id);

		const workspaceNode = this.nodes.get(rootNode.children[0]);
		if (!workspaceNode) {
			console.log('Workspace node not found');
			return;
		}
		this.convertedNodes.add(workspaceNode.id);

		let metaNodeId = workspaceNode.props._metaNodeId;
		if (metaNodeId) {
			const metaNode = this.nodes.get(metaNodeId);
			if (metaNode) {
				this.markSeen(metaNode);
			}
		}

		const libraryNode = this.nodes.get(rootNode.id + '_STASH');
		if (libraryNode != null) {
			this.importLibraryNode(libraryNode);
		}
		else {
			console.log('Library node not found');
		}

		for (let suffix of ['_TRASH', '_SCHEMA', '_SIDEBAR_AREAS', '_USERS']) {
			const specialNode = this.nodes.get(rootNode.id + suffix);
			if (specialNode != null) {
				this.markSeen(specialNode);
			}
			else {
				console.log('Special node ' + suffix + ' not found');
			}
		}

		this.enumerateChildren(workspaceNode, (childNode) => {
			if (childNode.props._docType == 'journal') {
				this.importDailyNotes(childNode);
			}
		});

		console.log('Converted ' + this.convertedNodes.size + ' nodes');
		let unconverted = 0;
		for (let node of this.tanaDatabase.docs) {
			if (!this.convertedNodes.has(node.id) && !node.id.startsWith('SYS') &&
				node.props._docType != 'workspace') {
				console.log('Found unconverted node: ' + node.id);
				unconverted++;
				if (unconverted == 20) break;
			}
		}
	}

	private importDailyNotes(node: TanaDoc) {
		this.convertedNodes.add(node.id);
		this.enumerateChildren(node, (yearNode) => {
			this.convertedNodes.add(yearNode.id);
			this.enumerateChildren(yearNode, (weekNode) => {
				this.convertedNodes.add(weekNode.id);
				this.enumerateChildren(weekNode, (dayNode) => {
					if (dayNode.props.name) {
						this.convertNode(dayNode, dayNode.props.name);
					}
				});
			});
		});
	}

	private importLibraryNode(node: TanaDoc) {
		this.convertedNodes.add(node.id);
		this.enumerateChildren(node, (childNode) => {
			this.convertNode(childNode, childNode.props.name);
		});
	}

	private convertNode(node: TanaDoc, filename: string) {
		this.convertedNodes.add(node.id);
		const fragments: Array<string> = [];
		this.enumerateChildren(node, (child) => {
			if (child.props._ownerId === node.id) {  // skip nodes which are included by reference
				this.convertNodeRecursive(child, fragments, 0);
			}
		});
		this.result.set(filename + '.md', fragments.join('\n'));
	}

	private convertNodeRecursive(node: TanaDoc, fragments: Array<string>, indent: number) {
		this.convertedNodes.add(node.id);
		const prefix = ' '.repeat(indent * 2) + '*';
		fragments.push(prefix + ' ' + this.convertMarkup(node.props.name ?? ''));
		this.enumerateChildren(node, (child) => {
			if (child.props._ownerId === node.id) {  // skip nodes which are included by reference
				this.convertNodeRecursive(child, fragments, indent + 1);
			}
		});
	}

	private convertMarkup(text: string): string {
		return text
			.replace(inlineRefRegex, (_, id) =>
				'[[' + (this.nodes.get(id)?.props?.name ?? '#') + ']]'
			)
			.replace(boldRegex, (_, content) => '**' + content + '**')
			.replace(italicRegex, (_, content) => '*' + content + '*');
	}

	private markSeen(node: TanaDoc) {
		this.convertedNodes.add(node.id);
		this.enumerateChildren(node, (child) => this.markSeen(child));
	}

	private enumerateChildren(node: TanaDoc, callback: (child: TanaDoc) => void) {
		if (!node.children) return;
		for (const childId of node.children) {
			if (childId.startsWith('SYS_')) continue;
			const childNode = this.nodes.get(childId);
			if (childNode) {
				callback(childNode);
			}
			else {
				console.log('Node with id ' + childId + ' not found');
			}
		}
	}
}
