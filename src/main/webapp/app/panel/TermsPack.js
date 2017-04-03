Ext.define('Voyant.panel.TermsPack', {
	extend: 'Ext.panel.Panel',
	mixins: ['Voyant.panel.Panel'],
	alias: 'widget.termspack',
    statics: {
    	i18n: {
    	},
    	api: {
    		stopList: 'auto',
    		context: 3,
    		query: undefined,
    		docIndex: undefined,
    		docId: undefined
    	},
		glyph: 'xf201@FontAwesome'
    },
    config: {
    	options: [{xtype: 'stoplistoption'}],
    	
    	mode: undefined,
    	
    	numInitialTerms: 50,
    	collocatesLimit: 1000000, // a very large number so we get all of them
    	scalingFactor: 3,
    	
    	minRawFreq: 1000000,
    	maxRawFreq: -1,
    	maxCollocateValue: -1,
    	
    	currentData: undefined,
    	
    	visLayout: undefined,
    	vis: undefined,
    	visInfo: undefined,
    	visId: undefined,
    	
    	tip: undefined
	},
    
	MODE_CORPUS: 'corpus',
    MODE_DOCUMENT: 'document',
    
    MIN_TERMS: 5,
    MAX_TERMS: 500,
    
    MIN_SCALING: 1,
    MAX_SCALING: 5,
	
    layout: 'fit',
    
    constructor: function(config) {
    	this.callParent(arguments);
    	this.mixins['Voyant.panel.Panel'].constructor.apply(this, arguments);
    	
    	this.setVisId(Ext.id(null, 'termspack_'));
    },
    
    initComponent: function() {
    	Ext.apply(this, {
    		title: this.localize('title'),
    		dockedItems: [{
                dock: 'bottom',
                xtype: 'toolbar',
                overflowHandler: 'scroller',
                items: [
//                {xtype: 'corpusdocumentselector', singleSelect: true},
                {
	                fieldLabel: this.localize('numTerms'),
	    			labelWidth: 50,
	    			width: 120,
	    			xtype: 'slider',
	            	increment: 1,
	            	minValue: this.MIN_TERMS,
	            	maxValue: this.MAX_TERMS,
	            	listeners: {
	            		afterrender: function(slider) {
	            			slider.setValue(this.getNumInitialTerms());
	            		},
	            		changecomplete: function(slider, newvalue) {
	            			this.resetVis();
	            			this.setNumInitialTerms(newvalue);
	            			this.loadFromCorpus(this.getCorpus());
	            		},
	            		scope: this
	            	}
                },{
	                fieldLabel: this.localize('scaling'),
	    			labelWidth: 50,
	    			width: 120,
	    			xtype: 'slider',
	            	increment: 1,
	            	minValue: this.MIN_SCALING,
	            	maxValue: this.MAX_SCALING,
	            	listeners: {
	            		afterrender: function(slider) {
	            			slider.setValue(this.getScalingFactor());
	            		},
	            		changecomplete: function(slider, newvalue) {
	            			// use the inverse of the value since it'll make more sense to the user
	            			var value = Math.abs(newvalue-(this.MAX_SCALING+1));
	            			
	            			this.setScalingFactor(value);
	            			
	            			this.getVisLayout().value(function(d) { return Math.pow(d.rawFreq, 1/value); });
	            			
	            			var data = this.processRecordsForVis([]);
	            			this.resetVis();
	            			this.buildVisFromData(data);
	            		},
	            		scope: this
	            	}
                }
                ]
    		}]
    	});
    	
    	this.callParent(arguments);
    },
    
    listeners: {
    	boxready: function() {
			this.initVisLayout();
    	},
    	
    	resize: function(panel, width, height) {
    		if (this.getVisLayout() && this.getCorpus()) {
    			var el = this.getLayout().getRenderTarget();
    	    	width = el.getWidth();
    			height = el.getHeight();
    			
    			el.down('svg').set({width: width, height: height});
    			
    			this.getVisLayout().size([width, height]);
    			
    			var data = this.processRecordsForVis([]);
    			this.resetVis();
    			this.buildVisFromData(data);
    		}
    	},
    	
    	loadedCorpus: function(src, corpus) {
    		this.loadFromCorpus(corpus);
    	}
    },
    
    loadFromCorpus: function(corpus) {
    	this.setApiParams({docId: undefined, docIndex: undefined});
    	corpus.getCorpusTerms().load({
    		params: {
 				limit: this.getNumInitialTerms(),
 				stopList: this.getApiParam('stopList')
 			},
		    callback: function(records, operation, success) {
		    	if (success) {
		    		this.setCurrentData({});
		    		this.loadFromRecords(records);
		    	}
		    },
		    scope: this
    	});
    },
    
    loadFromRecords: function(records) {
    	if (Ext.isArray(records) && records.length>0) {
    		var maxFreq = this.getMaxRawFreq();
    		var minFreq = this.getMinRawFreq();
    		var terms = [];
    		records.forEach(function(r) {
    			var term = r.getTerm();
    			var rawFreq = r.getRawFreq();
    			
    			if (rawFreq > maxFreq) maxFreq = rawFreq;
    			if (rawFreq < minFreq) minFreq = rawFreq;
    			
    			this.getCurrentData()[term] = {
    				term: term,
    				rawFreq: rawFreq,
    				relativeFreq: r.get('relativeFreq'),//r.getRelativeFreq(),
    				inDocumentsCount: r.getInDocumentsCount(),
    				collocates: []
    			};
    			
    			terms.push(term);
    		}, this);
    		
    		this.setMaxRawFreq(maxFreq);
    		this.setMinRawFreq(minFreq);
    		
    		this.loadFromQuery(terms);
    	}
    },
    
    loadFromQuery: function(query) {
    	this.setApiParams({
    		mode: 'corpus'
    	});
    	var params = this.getApiParams();
    	this.getCorpus().getCorpusCollocates().load({
    		params: Ext.apply(Ext.clone(params), {query: query, collocatesWhitelist: query, limit: this.getCollocatesLimit()}),
    		callback: function(records, op, success) {
    			if (success) {
    				this.buildVisFromData(this.processRecordsForVis(records));
    			}
    		},
    		scope: this
    	});
    },
    
    processRecordsForVis: function(records) {
    	var currentTerms = this.getCurrentData();

    	var maxCol = this.getMaxCollocateValue();
    	
    	for (var i=0; i<records.length; i++) {
    		var r = records[i];
    		var term = r.getTerm();
			var contextTerm = r.getContextTerm();
			var contextFreq = r.getContextTermRawFreq();
			
			if (contextFreq > maxCol) {
				maxCol = contextFreq;
			}
			
			if (currentTerms[term] === undefined) {
				// should not be here
			} else {
	    		if (term != contextTerm) {
	    			currentTerms[term].collocates.push({
	    				term: contextTerm, value: contextFreq
	    			});
	    		}
			}
    	}
    	
    	this.setMaxCollocateValue(maxCol);
    	
    	var data = [];
    	for (var term in currentTerms) {
    		data.push(currentTerms[term]);
    	}
    	return data;
    },
    
    buildVisFromData: function(data) {
    	// compute node xy
    	var processedData = this.getVisLayout().nodes({children: data, collocates:[], term: null, rawFreq: 0});
    	// join nodes with data
    	var nodes = this.getVis().selectAll('.node').data(processedData, function(d) { return d.term; } ); // use term as key
    	
    	// update
    	nodes.attr('transform', function(d) { return 'translate(' + d.x + ',' + d.y + ')'; });
    	nodes.selectAll('circle').attr('r', function(d) { return d.r; });
    	
    	var me = this;
    	
    	var collocateFill = d3.scale.pow().exponent(1/3)
			.domain([0,this.getMaxCollocateValue()]).range(['#ffffff', '#bd3163']);
    	
    	var inDocsFill = d3.scale.linear()
			.domain([2,this.getCorpus().getDocumentsCount()]).range(['#fff', '#ddd']);
    	
    	var count = nodes[0].length-1;
    	
    	var minFontSize = d3.scale.pow().exponent(1/2)
    		.domain([this.MIN_TERMS,this.MAX_TERMS]).range([16, 8])(count);
    	var maxFontSize = d3.scale.pow().exponent(1/2)
    		.domain([this.MIN_TERMS,this.MAX_TERMS]).range([20, 12])(count);
    	var textSizer = d3.scale.pow().exponent(1/2)
    		.domain([this.getMinRawFreq(),this.getMaxRawFreq()]).range([minFontSize, maxFontSize]);
    	
    	// enter
    	var node = nodes.enter().append('g')
    		.attr('class', 'node')
    		.style('visibility', function(d) { return d.depth > 0 ? 'visible' : 'hidden'; }) // hide root
    		.attr('transform', function(d) { return 'translate(' + d.x + ',' + d.y + ')'; })
    		.on('mouseover', function(d, i) {
    			me.getVis().selectAll('circle').style('stroke-width', 1).style('stroke', '#111')
        			.style('fill', function(d) { return inDocsFill(d.inDocumentsCount); });
    			
    			d3.select(this).select('circle').style('fill', '#89e1c2');
    			
    			var info = '<b>'+d.term+'</b> ('+d.rawFreq+')';
				var tip = me.getTip();
				tip.update(info);
				tip.show();
				
				for (var i = 0; i < d.collocates.length; i++) {
					var collocate = d.collocates[i];
					var match = me.getVis().selectAll('.node').filter(function(d) { return d.term === collocate.term; })
					match.select('circle')
						.style('fill', function(d) { return collocateFill(collocate.value); })
						.style('stroke', '#314b8b')
						.style('stroke-width', 3);
					match.select('tspan.value').text(function(d) { return collocate.value; });
				}
			})
			.on('mousemove', function() {
				var container = Ext.get(me.getVisId()).dom;
				var coords = d3.mouse(container);
				coords[1] += 20;
				me.getTip().setPosition(coords);
			})
			.on('mouseout', function() {
				me.getVis().selectAll('circle').style('stroke-width', 1).style('stroke', '#111')
	    			.style('fill', function(d) { return inDocsFill(d.inDocumentsCount); });
				me.getVis().selectAll('tspan.value').text('');
				me.getTip().hide();
//				me.getVisInfo().text('');
			});
    	
    	node.append('circle')
    		.attr('id', function(d) { return d.term; })
			.attr('r', function(d) { return d.r; })
			.style('fill', function(d) { return inDocsFill(d.inDocumentsCount); })
			.style('stroke', '#111')
			.style('stroke-opacity', 0.3)
			.style('stroke-width', 1);
    	
    	node.append('clipPath').attr('id', function(d) { return 'clip-' + d.term; })
    		.append('use').attr('xlink:href', function(d) { return '#' + d.term; });
		
    	var text = node.append('text')
    		.attr('clip-path', function(d) { return 'url(#clip-' + d.term + ')'; })
			.style('text-anchor', 'middle')
			.style('cursor', 'default');
		text.append('tspan')
			.attr('class', 'term')
			.style('font-size', function(d) { return textSizer(d.rawFreq); })
			.attr('x', 0)
			.attr('y', 0)
			.text(function(d) { return d.term; });
		text.append('tspan')
			.attr('class', 'value')
			.style('font-size', function(d) { return textSizer(d.rawFreq)-2; })
			.attr('x', 0)
			.attr('y', function(d) { return textSizer(d.rawFreq)+1; });
		
		// exit
    	nodes.exit().remove();
		
    },
    
    resetVis: function() {
    	this.getVis().selectAll('.node').remove();
    },
    
    initVisLayout: function() {
    	var el = this.getLayout().getRenderTarget();
		el.update(''); // make sure to clear existing contents (especially for re-layout)
    	var width = el.getWidth();
		var height = el.getHeight();
		
		var me = this;
		this.setVisLayout(
			d3.layout.pack()
				.sort(function(a, b) { return a.rawFreq < b.rawFreq ? 1 : a.rawFreq > b.rawFreq ? -1 : 0; })
				.value(function(d) { return Math.pow(d.rawFreq, 1/me.getScalingFactor()); })
				.size([width, height])
				.padding(1.5)
		);
		
		var svg = d3.select(el.dom).append('svg').attr('id',this.getVisId()).attr('width', width).attr('height', height);
		this.setVis(svg.append('g'));
		
		this.setVisInfo(svg.append('text').attr('x', 10).attr('y', 10));
		
		if (this.getTip() === undefined) {
			this.setTip(Ext.create('Ext.tip.Tip', {}));
		}
    }
});