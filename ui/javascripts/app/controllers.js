App.ApplicationController = Ember.ObjectController.extend({
  updateCurrentPath: function() {
    App.set('currentPath', this.get('currentPath'));
  }.observes('currentPath')
});

App.DcController = Ember.Controller.extend({
  needs: ["application"],
  // Whether or not the dropdown menu can be seen
  isDropdownVisible: false,

  datacenter: Ember.computed.alias('content'),

  // Returns the total number of failing checks.
  //
  // We treat any non-passing checks as failing
  //
  totalChecksFailing: function() {
    return this.get('nodes').reduce(function(sum, node) {
      return sum + node.get('failingChecks');
    }, 0);
  }.property('nodes'),

  totalChecksPassing: function() {
    return this.get('nodes').reduce(function(sum, node) {
      return sum + node.get('passingChecks');
    }, 0);
  }.property('nodes'),

  //
  // Returns the human formatted message for the button state
  //
  checkMessage: function() {
    var failingChecks = this.get('totalChecksFailing');
    var passingChecks = this.get('totalChecksPassing');

    if (this.get('hasFailingChecks') === true) {
      return  failingChecks + ' failing';
    } else {
      return  passingChecks + ' passing';
    }

  }.property('nodes'),

  //
  //
  //
  checkStatus: function() {
    if (this.get('hasFailingChecks') === true) {
      return "failing";
    } else {
      return "passing";
    }

  }.property('nodes'),

  //
  // Boolean if the datacenter has any failing checks.
  //
  hasFailingChecks: Ember.computed.gt('totalChecksFailing', 0),

  actions: {
    // Hide and show the dropdown menu
    toggle: function(item){
      this.toggleProperty('isDropdownVisible');
    },
    // Just hide the dropdown menu
    hideDrop: function(item){
      this.set('isDropdownVisible', false);
    }
  }
});

KvBaseController = Ember.ObjectController.extend({
  getParentKeyRoute: function() {
    if (this.get('isRoot')) {
      return this.get('rootKey');
    }
    return this.get('parentKey');
  },

  transitionToNearestParent: function(parent) {
    var controller = this;
    var rootKey = controller.get('rootKey');
    var dc = controller.get('dc').get('datacenter');
    var token = App.get('settings.token');

    Ember.$.ajax({
      url: (formatUrl(consulHost + '/v1/kv/' + parent + '?keys', dc, token)),
      type: 'GET'
    }).then(function(data) {
      controller.transitionToRoute('kv.show', parent);
    }).fail(function(response) {
      if (response.status === 404) {
        controller.transitionToRoute('kv.show', rootKey);
      }
    });

    controller.set('isLoading', false);
  }
});

App.KvShowController = KvBaseController.extend(Ember.Validations.Mixin, {
  needs: ["dc"],
  dc: Ember.computed.alias("controllers.dc"),
  isLoading: false,

  actions: {
    // Creates the key from the newKey model
    // set on the route.
    createKey: function() {
      this.set('isLoading', true);

      var controller = this;
      var newKey = controller.get('newKey');
      var parentKey = controller.get('parentKey');
      var grandParentKey = controller.get('grandParentKey');
      var dc = controller.get('dc').get('datacenter');
      var token = App.get('settings.token');

      // If we don't have a previous model to base
      // on our parent, or we're not at the root level,
      // add the prefix
      if (parentKey !== undefined && parentKey !== "/") {
        newKey.set('Key', (parentKey + newKey.get('Key')));
      }

      // Put the Key and the Value retrieved from the form
      Ember.$.ajax({
          url: (formatUrl(consulHost + "/v1/kv/" + newKey.get('Key'), dc, token)),
          type: 'PUT',
          data: newKey.get('Value')
      }).then(function(response) {
        // transition to the right place
        if (newKey.get('isFolder') === true) {
          controller.transitionToRoute('kv.show', newKey.get('Key'));
        } else {
          controller.transitionToRoute('kv.edit', newKey.get('Key'));
        }
        controller.set('isLoading', false);
      }).fail(function(response) {
        // Render the error message on the form if the request failed
        controller.set('errorMessage', 'Received error while processing: ' + response.statusText);
      });
    },

    deleteFolder: function() {

      this.set('isLoading', true);
      var controller = this;
      var dc = controller.get('dc').get('datacenter');
      var grandParent = controller.get('grandParentKey');
      var token = App.get('settings.token');

      if (window.confirm("Are you sure you want to delete this folder?")) {
        // Delete the folder
        Ember.$.ajax({
            url: (formatUrl(consulHost + "/v1/kv/" + controller.get('parentKey') + '?recurse', dc, token)),
            type: 'DELETE'
        }).then(function(response) {
          controller.transitionToNearestParent(grandParent);
        }).fail(function(response) {
          // Render the error message on the form if the request failed
          controller.set('errorMessage', 'Received error while processing: ' + response.statusText);
        });
      }
    },

    copyFolderContent: function () {
      var controller = this;
      var dc = controller.get('dc').get('datacenter');
      var token = App.get('settings.token');

      Ember.$.ajax({
        url: (formatUrl(consulHost + "/v1/kv/" + controller.get('parentKey') + '?recurse', dc, token)),
        type: 'GET'
      }).then(function(response) {
        var regExp = new RegExp('^' + controller.get('parentKey'));

        App.set('copyPasteBuffer', response.map(function (item) {
          item.Key = item.Key.replace(regExp, '');
          return item;
        }));
      });
    },

    pasteInThisFolder: function () {
      var controller = this;
      var dc = controller.get('dc').get('datacenter');
      var token = App.get('settings.token');
      var pasteData = App.get('copyPasteBuffer');
      var parentKey = controller.get('parentKey');

      var pasteDataArrays = [],
          chunk = 64;

      for (var i = 0, imax = pasteData.length; i < imax; i += chunk) {
        pasteDataArrays.push(pasteData.slice(i, i+chunk));
      }

      var pasteRequest = function (keys) {
            return Ember.$.ajax({
              url: formatUrl(consulHost + '/v1/txn', dc, token),
              type: 'PUT',
              data: JSON.stringify(keys.map(function (item) {
                return {
                  KV: {
                    Verb: 'set',
                    Key: ((parentKey === '/') ? '' : parentKey) + item.Key,
                    Value: item.Value,
                    Flags: item.Flags
                  }
                };
              }))
            });
          },
          pasteRequests = [];

      for (i = 0, imax = pasteDataArrays.length; i < imax; i++) {
        pasteRequests.push(pasteRequest(pasteDataArrays[i]));
      }

      Ember.$.when.apply(Ember.$, pasteRequests).then(function() {
        controller.get('target.router').refresh();
      }).fail(function(response) {
        notify('Received error while processing: ' + (response.responseText || response.statusText), 8000);
      });
    }
  }
});

App.KvEditController = KvBaseController.extend({
  isLoading: false,
  needs: ["dc"],
  dc: Ember.computed.alias("controllers.dc"),

  actions: {
    // Updates the key set as the model on the route.
    updateKey: function() {
      this.set('isLoading', true);

      var dc = this.get('dc').get('datacenter');
      var key = this.get("model");
      var controller = this;
      var token = App.get('settings.token');

      // Put the key and the decoded (plain text) value
      // from the form.
      Ember.$.ajax({
          url: (formatUrl(consulHost + "/v1/kv/" + key.get('Key'), dc, token)),
          type: 'PUT',
          data: key.get('valueDecoded')
      }).then(function(response) {
        // If success, just reset the loading state.
        controller.set('isLoading', false);
      }).fail(function(response) {
        // Render the error message on the form if the request failed
        controller.set('errorMessage', 'Received error while processing: ' + response.statusText);
      });
    },

    cancelEdit: function() {
      this.set('isLoading', true);
      this.transitionToRoute('kv.show', this.getParentKeyRoute());
      this.set('isLoading', false);
    },

    deleteKey: function() {
      this.set('isLoading', true);

      var controller = this;
      var dc = controller.get('dc').get('datacenter');
      var key = controller.get("model");
      var parent = controller.getParentKeyRoute();
      var token = App.get('settings.token');

      // Delete the key
      Ember.$.ajax({
          url: (formatUrl(consulHost + "/v1/kv/" + key.get('Key'), dc, token)),
          type: 'DELETE'
      }).then(function(data) {
        controller.transitionToNearestParent(parent);
      }).fail(function(response) {
        // Render the error message on the form if the request failed
        controller.set('errorMessage', 'Received error while processing: ' + response.statusText);
      });
    },

    copyKey: function () {
      var item = this.get('model');
      var itemKeyPath = item.Key.split('/');

      item = {
        Key: itemKeyPath[itemKeyPath.length - 1],
        Value: item.Value,
        Flags: item.Flags
      };

      App.set('copyPasteBuffer', [item]);
    }
  }

});

ItemBaseController = Ember.ArrayController.extend({
  needs: ["dc", "application"],
  queryParams: ["filter", "status", "condensed", "tag"],
  dc: Ember.computed.alias("controllers.dc"),
  condensed: true,
  hasExpanded: true,
  filterText: "Filter by name",
  filter: "", // default
  status: "any status", // default
  statuses: ["any status", "passing", "failing"],
  tag: "any tags", // default
  tags: ["any tags", "PROD", "QA", "DEV"],

  isShowingItem: function() {
    var currentPath = this.get('controllers.application.currentPath');
    return (currentPath === "dc.nodes.show" || currentPath === "dc.services.show");
  }.property('controllers.application.currentPath'),

  filteredContent: function() {
    var filter = this.get('filter');
    var status = this.get('status');
    var tag = this.get('tag');

    var items = this.get('items').filter(function(item){
      return item.get('filterKey').toLowerCase().match(filter.toLowerCase());
    });

    var nodes = this.get('dc.nodes');

    switch (status) {
      case "passing":
        items = items.filterBy('hasFailingChecks', false);
        break;
      case "failing":
        items = items.filterBy('hasFailingChecks', true);
        break;
    }

    for (var i = 0, imax = items.length; i < imax; i++) {
      items[i].Tags = [];

      for (var j = 0, jmax = (items[i].Nodes || []).length; j < jmax; j++) {
        for (var k = 0, kmax = (nodes || []).length; k < kmax; k++) {
          if (items[i].Nodes[j] === nodes[k].Node) {
            for (var m = 0, mmax = (nodes[k].Services || []).length; m < mmax; m++) {
              if (nodes[k].Services[m].Service === items[i].Name) {
                for (var n = 0, nmax = (nodes[k].Services[m].Tags || []).length; n < nmax; n++) {
                  if ($.inArray(nodes[k].Services[m].Tags[n], items[i].Tags) === -1) {
                    items[i].Tags.push(nodes[k].Services[m].Tags[n]);
                  }
                }
              }
            }
          }
        }
      }
    }

    switch (tag) {
      case "PROD":
      case "QA":
      case "DEV":
        items = items.filter(function (item) {
          return $.inArray(tag, item.Tags) !== -1;
        });
    }

    return items;
  }.property('filter', 'status', 'tag', 'items.@each'),

  actions: {
    toggleCondensed: function() {
      this.toggleProperty('condensed');
    },

    openNodeServicePopup: function(service, node) {
      this.set('registerNodesPrompt', 'Loading nodes...');

      Ember.$.getJSON(formatUrl(consulHost + '/v1/internal/ui/nodes', this.get('dc').get('datacenter'),
                                App.get('settings.token'))).then(Ember.run.bind(this, function (data) {
        var nodes = [];

        if (data && data.length) {
          nodes = data.map(function (item) {
            return item.Node;
          });
        }

        var registerTag = '',
            registerTags = ['PROD', 'QA', 'DEV'],
            registerCustomTagsString = '';

        if (service && service.Tags && service.Tags.length) {
          for (var i = 0, imax = service.Tags.length; i < imax; i++) {
            if ($.inArray(service.Tags[i], registerTags) !== -1) {
              registerTag = service.Tags[i];
              break;
            }
          }

          if (registerTag) {
            var registerCustomTags = [];

            for (var j = 0, jmax = service.Tags.length; j < jmax; j++) {
              if (service.Tags[j] !== registerTag) {
                registerCustomTags.push(service.Tags[j]);
              }
            }

            registerCustomTagsString = registerCustomTags.join(', ');
          }
        }

        this.setProperties({
          isRegisterEditing: !!service,
          registerName: service ? service.Service : '',
          registerNode: node ? node.Node.Node : '',
          registerNodes: nodes,
          registerTag: registerTag,
          registerTags: registerTags,
          registerCustomTags: registerCustomTagsString,
          registerNodesPrompt: 'Please select a node',
          registerAddress: service ? service.Address : '',
          registerPort: service ? service.Port : ''
        });

        Ember.run.next(this, function () {
          this.set('registerId', service ? service.ID : '');
        });
      }));

      Ember.run.later(function () {
        $('.js-popup--form_register_service').show().scrollTop(0);
        $('body').css('overflow', 'hidden');
      }, 100);
    },

    closeNodeServicePopup: function() {
      $('.js-popup--form_register_service').hide();
      $('body').css('overflow', 'auto');
    },

    registerNodeService: function (isEditing) {
      var registerCustomTags = (this.get('registerCustomTags') || '').split(/[ ,]+/);
      var registerCustomTag;
      var tags = [];

      for (var i = 0, imax = registerCustomTags.length; i < imax; i++) {
        registerCustomTag = $.trim(registerCustomTags[i]);

        if (registerCustomTag) {
          tags.push(registerCustomTag);
        }
      }

      if (this.get('registerTag')) {
        tags.unshift(this.get('registerTag'));
      }

      if (!this.get('registerNode') && !isEditing) {
        notify('Please select a node', 3000);
        return;
      } else if (!$.trim(this.get('registerName')) && !isEditing) {
        notify('Please enter service name', 3000);
        return;
      } else if (!tags.length && !isEditing) {
        notify('Please select at least one tag', 3000);
        return;
      } else if (!$.trim(this.get('registerAddress')) && !$.trim(this.get('registerPort'))) {
        notify('Please enter an address or a port', 3000);
        return;
      } else if (!$.trim(this.get('registerId')) && !isEditing) {
        notify('Please enter ID', 3000);
        return;
      }

      var data = {
        ID: $.trim(this.get('registerId')),
        Name: $.trim(this.get('registerName')),
        Tags: tags
      };

      if (this.get('registerAddress')) {
        data.Address = $.trim(this.get('registerAddress'));
      } else if (this.get('registerPort')) {
        data.Port = this.get('registerPort');
      }

      $('.js-popup--form_register_service_status').addClass('b-popup-loading');

      Ember.$.ajax({
        type: 'post',
        dataType: 'json',
        contentType: 'application/json',
        url: formatUrl(getNodeHost(this.get('registerNode')) + '/v1/agent/service/register',
             this.get('dc').get('datacenter'), App.get('settings.token')),
        data: JSON.stringify(data)
      }).then(Ember.run.bind(this, function() {
        if (isEditing) {
          this.transitionToRoute('services');

          Ember.run.later(this, function () {
            $('.js-popup--form_register_service').hide();
            $('.js-popup--form_register_service_status').removeClass('b-popup-loading');
            $('body').css('overflow', 'auto');
            this.transitionToRoute('services.show', $.trim(this.get('registerName')));
          }, 500);
        } else {
          $('.js-popup--form_register_service').hide();
          $('.js-popup--form_register_service_status').removeClass('b-popup-loading');
          $('body').css('overflow', 'auto');
          this.transitionToRoute('index');
        }
      })).fail(function() {
        notify('Received error while registering service', 8000);

        Ember.run.later(function () {
          $('.js-popup--form_register_service_status').removeClass('b-popup-loading');
        }, 800);
      });
    }
  },

  watchRegisterName: function () {
    if (this.get('registerName')) {
      this.set('registerId', $.trim((this.get('registerName') || '') + ' ' + (this.get('registerTag') || '')));
    }
  }.observes('registerName'),

  watchRegisterTag: function () {
    if (this.get('registerTag')) {
      this.set('registerId', $.trim((this.get('registerName') || '') + ' ' + (this.get('registerTag') || '')));
    }
  }.observes('registerTag'),

  watchRegisterAddress: function () {
    if (this.get('registerAddress')) {
      this.set('registerPort', '');
    }
  }.observes('registerAddress'),

  watchRegisterPort: function () {
    if (this.get('registerPort')) {
      this.set('registerAddress', '');
    }
  }.observes('registerPort')
});

App.NodesShowController = Ember.ObjectController.extend({
  needs: ["dc", "nodes"],
  dc: Ember.computed.alias("controllers.dc"),

  actions: {
    deregisterNodeService: function(service) {
      this.set('isLoading', true);
      var controller = this;
      var node = controller.get('model');
      var dc = controller.get('dc').get('datacenter');
      var token = App.get('settings.token');

      if (window.confirm("Are you sure you want to deregister this service?")) {
        // Deregister service
        Ember.$.ajax({
          url: formatUrl(getNodeHost(node.Node) + '/v1/agent/service/deregister/' + service.ID, dc, token)
        }).then(function() {
          node.Services.removeObject(service);
        }).fail(function(response) {
          notify('Received error while processing: ' + (response.responseText || response.statusText), 8000);
        });
      }
    },

    deregisterNodeCheck: function(check) {
      this.set('isLoading', true);
      var controller = this;
      var node = controller.get('model');
      var dc = controller.get('dc').get('datacenter');
      var token = App.get('settings.token');

      if (window.confirm("Are you sure you want to deregister this check?")) {
        // Deregister check
        Ember.$.ajax({
          url: formatUrl(getNodeHost(node.Node) + '/v1/agent/check/deregister/' + check.CheckID, dc, token)
        }).then(function() {
          node.Checks.removeObject(check);
        }).fail(function(response) {
          notify('Received error while processing: ' + (response.responseText || response.statusText), 8000);
        });
      }
    },

    invalidateSession: function(sessionId) {
      this.set('isLoading', true);
      var controller = this;
      var node = controller.get('model');
      var dc = controller.get('dc').get('datacenter');
      var token = App.get('settings.token');

      if (window.confirm("Are you sure you want to invalidate this session?")) {
        // Delete the session
        Ember.$.ajax({
            url: (formatUrl(consulHost + "/v1/session/destroy/" + sessionId, dc, token)),
            type: 'PUT'
        }).then(function(response) {
          return Ember.$.getJSON(formatUrl(consulHost + '/v1/session/node/' + node.Node, dc, token)).then(function(data) {
            controller.set('sessions', data);
          });
        }).fail(function(response) {
          // Render the error message on the form if the request failed
          controller.set('errorMessage', 'Received error while processing: ' + response.statusText);
        });
      }
    }
  }
});

App.NodesController = ItemBaseController.extend({
  items: Ember.computed.alias("nodes"),
});

App.ServicesController = ItemBaseController.extend({
  items: Ember.computed.alias("services")
});

App.ServicesShowController = Ember.ObjectController.extend({
  needs: ["dc", "services"],
  dc: Ember.computed.alias("controllers.dc"),

  actions: {
    editService: function (service, node) {
      Ember.run.bind(this.get('controllers.services'),
                     this.get('controllers.services._actions').openNodeServicePopup)(service, node);
    },

    deregisterService: function(node) {
      this.set('isLoading', true);
      var controller = this;
      var dc = controller.get('dc').get('datacenter');
      var token = App.get('settings.token');
      var service = node ? node.Service : controller.model[0].Service;

      if (window.confirm('Are you sure you want to deregister service "' + (node ? service.ID : service.Service) + '"?')) {
        var nodeService = controller.get('controllers.services').get('services').find(function(n) {
              return n.Name === service.Service;
            }),
            deregisterRequest = function (nodeId, serviceId) {
              return Ember.$.ajax({
                url: formatUrl(getNodeHost(nodeId) + '/v1/agent/service/deregister/' + (serviceId || service.ID), dc, token)
              });
            },
            deregisterRequests = [];

        if (node) {
          deregisterRequests.push(deregisterRequest(node.Node.Node));
        } else {
          for (var i = 0, imax = controller.model.length; i < imax; i++) {
            deregisterRequests.push(deregisterRequest(controller.model[i].Node.Node, controller.model[i].Service.ID));
          }
        }

        // Deregister service
        Ember.$.when.apply(Ember.$, deregisterRequests).then(function() {
          var isDeregisterOnAllNodes = !node || (node && nodeService.Nodes.length === 1);

          if (isDeregisterOnAllNodes) {
            var services = controller.get('controllers.services').get('services');

            controller.get('controllers.services').set('services', services.filter(function(n) {
              return n.Name !== service.Service;
            }));

            controller.transitionToRoute('services');
          } else {
            controller.get('model').removeObject(node);
          }
        }).fail(function(response) {
          notify('Received error while processing: ' + (response.responseText || response.statusText), 8000);
        });
      }
    }
  }
});

App.AclsController = Ember.ArrayController.extend({
  needs: ["dc", "application"],
  queryParams: ["filter"],
  filterText: "Filter by name or ID",
  searchBar: true,
  newAclButton: true,
  types: ["management", "client"],

  dc: Ember.computed.alias("controllers.dc"),
  items: Ember.computed.alias("acls"),

  filter: "",

  isShowingItem: function() {
    var currentPath = this.get('controllers.application.currentPath');
    return (currentPath === "dc.acls.show");
  }.property('controllers.application.currentPath'),

  filteredContent: function() {
    var filter = this.get('filter');

    var items = this.get('items').filter(function(item, index, enumerable){
      // First try to match on the name
      var nameMatch = item.get('Name').toLowerCase().match(filter.toLowerCase());
      if (nameMatch !== null) {
        return nameMatch;
      } else {
        return item.get('ID').toLowerCase().match(filter.toLowerCase());
      }
    });

    return items;
  }.property('filter', 'items.@each'),

  actions: {
    createAcl: function() {
      this.set('isLoading', true);

      var controller = this;
      var newAcl = controller.get('newAcl');
      var dc = controller.get('dc').get('datacenter');
      var token = App.get('settings.token');

      // Create the ACL
      Ember.$.ajax({
          url: formatUrl(consulHost + '/v1/acl/create', dc, token),
          type: 'PUT',
          data: JSON.stringify(newAcl)
      }).then(function(response) {
        // transition to the acl
        controller.transitionToRoute('acls.show', response.ID);

        // Get the ACL again, including the newly created one
        Ember.$.getJSON(formatUrl(consulHost + '/v1/acl/list', dc, token)).then(function(data) {
          var objs = [];
          data.map(function(obj){
            objs.push(App.Acl.create(obj));
          });
          controller.set('items', objs);
        });

        controller.set('isLoading', false);
      }).fail(function(response) {
        // Render the error message on the form if the request failed
        notify('Received error while creating ACL: ' + response.statusText, 8000);
        controller.set('isLoading', false);
      });
    },
  }
});


App.AclsShowController = Ember.ObjectController.extend({
  needs: ["dc", "acls"],
  dc: Ember.computed.alias("controllers.dc"),
  isLoading: false,
  types: ["management", "client"],

  actions: {
    set: function() {
      this.set('isLoading', true);
      var controller = this;
      var acl = controller.get('model');
      var dc = controller.get('dc').get('datacenter');

      if (window.confirm("Are you sure you want to use this token for your session?")) {
        // Set
        var token = App.set('settings.token', acl.ID);
        controller.transitionToRoute('services');
        this.set('isLoading', false);
        notify('Now using token: ' + acl.ID, 3000);
      }
    },

    clone: function() {
      this.set('isLoading', true);
      var controller = this;
      var acl = controller.get('model');
      var dc = controller.get('dc').get('datacenter');
      var token = App.get('settings.token');

      // Set
      controller.transitionToRoute('services');

      Ember.$.ajax({
          url: formatUrl(consulHost + '/v1/acl/clone/'+ acl.ID, dc, token),
          type: 'PUT'
      }).then(function(response) {
        controller.transitionToRoute('acls.show', response.ID);
        controller.set('isLoading', false);
        notify('Successfully cloned token', 4000);
      }).fail(function(response) {
        // Render the error message on the form if the request failed
        controller.set('errorMessage', 'Received error while processing: ' + response.statusText);
        controller.set('isLoading', false);
      });

    },

    delete: function() {
      this.set('isLoading', true);
      var controller = this;
      var acl = controller.get('model');
      var dc = controller.get('dc').get('datacenter');
      var token = App.get('settings.token');

      if (window.confirm("Are you sure you want to delete this token?")) {
        Ember.$.ajax({
            url: formatUrl(consulHost + '/v1/acl/destroy/'+ acl.ID, dc, token),
            type: 'PUT'
        }).then(function(response) {
          Ember.$.getJSON(formatUrl(consulHost + '/v1/acl/list', dc, token)).then(function(data) {
            objs = [];
            data.map(function(obj){
              if (obj.ID === "anonymous") {
                objs.unshift(App.Acl.create(obj));
              } else {
                objs.push(App.Acl.create(obj));
              }
            });
            controller.get('controllers.acls').set('acls', objs);
          }).then(function() {
            controller.transitionToRoute('acls');
            controller.set('isLoading', false);
            notify('ACL deleted successfully', 3000);
          });
        }).fail(function(response) {
          // Render the error message on the form if the request failed
          controller.set('errorMessage', 'Received error while processing: ' + response.statusText);
          controller.set('isLoading', false);
        });
      }
    },

    updateAcl: function() {
      this.set('isLoading', true);

      var controller = this;
      var acl = controller.get('model');
      var dc = controller.get('dc').get('datacenter');
      var token = App.get('settings.token');

      // Update the ACL
      Ember.$.ajax({
          url: formatUrl(consulHost + '/v1/acl/update', dc, token),
          type: 'PUT',
          data: JSON.stringify(acl)
      }).then(function(response) {
        // transition to the acl
        controller.set('isLoading', false);
        notify('ACL updated successfully', 3000);
      }).fail(function(response) {
        // Render the error message on the form if the request failed
        notify('Received error while updating ACL: ' + response.statusText, 8000);
        controller.set('isLoading', false);
      });
    }
  }
});

App.SettingsController = Ember.ObjectController.extend({
  actions: {
    reset: function() {
      this.set('isLoading', true);
      var controller = this;

      if (window.confirm("Are your sure you want to reset your settings?")) {
        localStorage.clear();
        controller.set('content', App.Settings.create());
        App.set('settings.token', '');
        notify('Settings reset', 3000);
        this.set('isLoading', false);
      }
    }
  }
});
