'use strict';

var StateMachine = require('fsm-as-promised');
var Promise = require('bluebird');
var _ = require('lodash');

module.exports = function(bookshelf, options) {

    if (!options.init_on) options.init_on = ['created', 'fetched'];

    var Base = bookshelf.Model.extend({

        'initialize': function() {
            var self = this;
            this._stateMachineCreated = false;
            this._activeTransition = null;
            _.each(options.init_on, function(event) {
                self.on(event, function() {
                    self._initStateMachine();
                });
            });
            bookshelf.Model.prototype.initialize.apply(this, arguments);
        },

        '_initStateMachine': function() {
            if (this._stateMachineCreated) return;
            var self = this;
            var callbacks = this._getFSMCallbacks() || [];
            var events = this._getFSMEvents() || [];
            for (var k in callbacks) {
                callbacks[k] = callbacks[k].bind(self);
            }
            var initial = this._getCurrentState();
            StateMachine({
                'initial': initial,
                'events': events,
                'callbacks': callbacks
            }, self);
            this._stateMachineCreated = true;
            var uniqueEvents = _.uniq(_.map(events, 'name'));
            _.each(uniqueEvents, function(e) {
                var transitions = _.filter(events, {
                    'name': e
                });
                var fn = self[e];
                self[e] = function() {
                    var args = _.toArray(arguments);
                    return new Promise(function(resolve, reject) {
                        if (self._activeTransition) return reject('Model is currently in the middle of a transition');
                        var thisTransition = _.find(transitions, function(transition) {
                            if (_.isArray(transition.from)) {
                              return _.includes(transition.from, self.get('state'));
                            }

                            return transition.from === self.get('state');
                        });
                        if (!thisTransition) {
                            return reject('Transition from ' + self.get('state') + ' via ' + e +
                            ' not supported');
                        }
                        self._activeTransition = thisTransition;
                        self.trigger('transitioning', thisTransition.to, thisTransition.from, thisTransition.name);
                        fn.apply(self, args).then(function(result) {
                            if (!thisTransition) { // fsm-as-promised should catch this
                                return reject('Unknown transition');
                            }
                            self.set('state', thisTransition.to);
                            self.save().then(function() {
                                self._activeTransition = null;
                                self.trigger('transitioned', thisTransition.to, thisTransition.from, thisTransition.name);
                                self.trigger('transitioned_to_' + thisTransition.to, thisTransition.from, thisTransition.name);
                                resolve(result);
                            }).catch(function(err) {
                                self._activeTransition = null;
                                reject(err);
                            });
                        }).catch(function(err) {
                            self._activeTransition = null;
                            reject(err);
                        });
                    });
                };
            });
        },

        '_getCurrentState': function() {
            return this.get('state');
        }

    });

    return Base;

};
